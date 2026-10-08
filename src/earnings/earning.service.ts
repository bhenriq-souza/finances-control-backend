import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import type { DataSource } from 'typeorm';

import { BankAccountService, BankAccountServiceSymbol } from '../accounts';
import {
    EARNING_CREATED,
    EARNING_RECEIVED,
    type EarningCreated,
    type EarningReceived,
} from '../events';
import { DatabaseConnectionSymbol, TransactionRunnerSymbol, businessToday } from '../platform';
import type { TransactionRunner } from '../platform';
import { Earning } from './earning.entity';
import { EarningTypeServiceSymbol } from './earnings.symbols';
import type { EarningStatus } from './earning-status';
import type {
    ChangeEarningStatusInput,
    CreateEarningInput,
    ListEarningsQuery,
    UpdateEarningInput,
} from './earning.schemas';
import type { EarningTypeService } from './earning-type.service';

export type EarningWithType = Earning & { earningType: NonNullable<Earning['earningType']> };

/** Transições permitidas por `PATCH /earnings/:id/status` (spec 0014, "Máquina de status"). */
const ALLOWED_TRANSITIONS: Readonly<Record<EarningStatus, readonly EarningStatus[]>> = {
    FORECAST: ['OPEN'],
    OPEN: ['VERIFYING', 'RECEIVED'],
    OVERDUE: ['VERIFYING', 'RECEIVED'],
    VERIFYING: ['OPEN', 'RECEIVED'],
    RECEIVED: ['OPEN'],
};

const earningNotFound = (): CustomError =>
    CustomError.notFound('Earning not found', 'EARNING_NOT_FOUND', { exposeMessage: true });

/** ERR-0014-10: o saldo já absorveu a receita recebida. */
const alreadyReceived = (): CustomError =>
    new CustomError(
        409,
        'EARNING_ALREADY_RECEIVED',
        'The earning is already received; undo the receipt first',
        { exposeMessage: true },
    );

@injectable()
export class EarningService {
    constructor(
        @inject(DatabaseConnectionSymbol) private readonly dataSource: DataSource,
        @inject(TransactionRunnerSymbol) private readonly transactions: TransactionRunner,
        @inject(BankAccountServiceSymbol) private readonly accounts: BankAccountService,
        @inject(EarningTypeServiceSymbol) private readonly types: EarningTypeService,
    ) {}

    /**
     * Cria a receita e publica `EarningCreated`, na mesma transação (spec 0004). Criar
     * nunca move o saldo corrente: só receita recebida o move (INV-0014-03).
     */
    async create(input: CreateEarningInput): Promise<EarningWithType[]> {
        // Existência (404) antes de arquivamento (409), conta antes de tipo.
        const account = await this.accounts.findById(input.bankAccountId);
        const type = await this.types.findById(input.earningTypeId);

        if (account.archivedAt) {
            throw new CustomError(409, 'BANK_ACCOUNT_ARCHIVED', 'This bank account is archived', {
                exposeMessage: true,
            });
        }

        if (type.archivedAt) {
            throw new CustomError(409, 'EARNING_TYPE_ARCHIVED', 'This earning type is archived', {
                exposeMessage: true,
            });
        }

        const status = input.status ?? 'OPEN';

        const id = await this.transactions.run(async (scope) => {
            const repository = scope.manager.getRepository(Earning);
            const saved = await repository.save(
                repository.create({
                    description: input.description,
                    earningTypeId: input.earningTypeId,
                    kind: input.kind,
                    status,
                    amountCents: input.amountCents,
                    occurredOn: input.occurredOn,
                    receivedOn: null,
                    bankAccountId: input.bankAccountId,
                    installmentGroupId: null,
                    installmentNumber: null,
                    installmentTotal: null,
                    notes: input.notes ?? null,
                }),
            );

            const event: Omit<EarningCreated, 'occurredAt' | 'correlationId'> = {
                name: EARNING_CREATED,
                payload: {
                    earningId: saved.id,
                    kind: input.kind,
                    status,
                    amountCents: input.amountCents,
                    occurredOn: input.occurredOn,
                    bankAccountId: input.bankAccountId,
                    installmentGroupId: null,
                },
            };
            scope.publish(event);

            return saved.id;
        });

        // Recarrega porque `created_at` é do banco e o INSERT do ORM não a traz.
        const created = await this.dataSource
            .getRepository(Earning)
            .findOneOrFail({ where: { id }, relations: { earningType: true } });

        return [created as EarningWithType];
    }

    /** ERR-0014-02 para `:id` inexistente. */
    async findById(id: string): Promise<EarningWithType> {
        const earning = await this.dataSource
            .getRepository(Earning)
            .findOne({ where: { id }, relations: { earningType: true } });

        if (!earning) throw earningNotFound();

        return earning as EarningWithType;
    }

    /** AC-0014-10: filtros por E; `from`/`to` inclusivos sobre `occurredOn`. */
    async list(query: ListEarningsQuery = {}): Promise<EarningWithType[]> {
        const qb = this.dataSource
            .getRepository(Earning)
            .createQueryBuilder('e')
            .innerJoinAndSelect('e.earningType', 'earningType')
            .orderBy('e.occurredOn', 'ASC')
            .addOrderBy('e.createdAt', 'ASC')
            .addOrderBy('e.id', 'ASC');

        if (query.from !== undefined) qb.andWhere('e.occurredOn >= :from', query);
        if (query.to !== undefined) qb.andWhere('e.occurredOn <= :to', query);
        if (query.status !== undefined) qb.andWhere('e.status = :status', query);
        if (query.kind !== undefined) qb.andWhere('e.kind = :kind', query);
        if (query.earningTypeId !== undefined) {
            qb.andWhere('e.earningTypeId = :earningTypeId', query);
        }
        if (query.bankAccountId !== undefined) {
            qb.andWhere('e.bankAccountId = :bankAccountId', query);
        }
        if (query.installmentGroupId !== undefined) {
            qb.andWhere('e.installmentGroupId = :installmentGroupId', query);
        }

        return (await qb.getMany()) as EarningWithType[];
    }

    /**
     * Receita recebida não muda valor nem conta (ERR-0014-10, INV-0014-07). Não recebida
     * não está no saldo de conta nenhuma, então trocar conta ou valor não move nada.
     * Existência (404) antes de arquivamento (409), conta antes de tipo.
     */
    async update(id: string, changes: UpdateEarningInput): Promise<EarningWithType> {
        await this.transactions.run(async (scope) => {
            const repository = scope.manager.getRepository(Earning);
            const earning = await repository.findOne({
                where: { id },
                lock: { mode: 'for_no_key_update' },
            });

            if (!earning) throw earningNotFound();

            if (
                earning.status === 'RECEIVED' &&
                (changes.amountCents !== undefined || changes.bankAccountId !== undefined)
            ) {
                throw alreadyReceived();
            }

            if (
                changes.bankAccountId !== undefined &&
                changes.bankAccountId !== earning.bankAccountId
            ) {
                const account = await this.accounts.findById(changes.bankAccountId);

                if (account.archivedAt) {
                    throw new CustomError(
                        409,
                        'BANK_ACCOUNT_ARCHIVED',
                        'This bank account is archived',
                        { exposeMessage: true },
                    );
                }
            }

            if (
                changes.earningTypeId !== undefined &&
                changes.earningTypeId !== earning.earningTypeId
            ) {
                const type = await this.types.findById(changes.earningTypeId);

                if (type.archivedAt) {
                    throw new CustomError(
                        409,
                        'EARNING_TYPE_ARCHIVED',
                        'This earning type is archived',
                        { exposeMessage: true },
                    );
                }
            }

            await repository.update({ id }, changes);
        });

        return this.findById(id);
    }

    /** Só receita não recebida se exclui (ERR-0014-10); excluir não move saldo. */
    delete(id: string): Promise<void> {
        return this.transactions.run(async (scope) => {
            const repository = scope.manager.getRepository(Earning);
            const earning = await repository.findOne({
                where: { id },
                lock: { mode: 'for_no_key_update' },
            });

            if (!earning) throw earningNotFound();
            if (earning.status === 'RECEIVED') throw alreadyReceived();

            await repository.delete({ id });
        });
    }

    /**
     * Aplica uma transição de status. Receber soma `amountCents` ao saldo corrente da
     * conta e desfazer o devolve, na mesma transação (INV-0014-03); `EarningReceived`
     * só sai após o commit e desfazer não publica evento.
     */
    async changeStatus(id: string, change: ChangeEarningStatusInput): Promise<EarningWithType> {
        await this.transactions.run(async (scope) => {
            const repository = scope.manager.getRepository(Earning);
            // `for_no_key_update`: `pessimistic_write` conflita com o KEY SHARE das FKs.
            // Sem relations, pois o lock não se aplica a JOIN externo.
            const earning = await repository.findOne({
                where: { id },
                lock: { mode: 'for_no_key_update' },
            });

            if (!earning) {
                throw CustomError.notFound('Earning not found', 'EARNING_NOT_FOUND', {
                    exposeMessage: true,
                });
            }

            const from = earning.status;
            const to = change.status;

            if (!ALLOWED_TRANSITIONS[from].includes(to)) {
                throw new CustomError(
                    409,
                    'EARNING_STATUS_TRANSITION_NOT_ALLOWED',
                    `Cannot change an earning from ${from} to ${to}`,
                    { exposeMessage: true },
                );
            }

            if (to === 'RECEIVED') {
                const receivedOn = change.receivedOn ?? businessToday();

                await repository.update({ id }, { status: to, receivedOn });
                await this.accounts.applyBalanceDelta(
                    scope.manager,
                    earning.bankAccountId,
                    earning.amountCents,
                );

                const event: Omit<EarningReceived, 'occurredAt' | 'correlationId'> = {
                    name: EARNING_RECEIVED,
                    payload: {
                        earningId: id,
                        amountCents: earning.amountCents,
                        bankAccountId: earning.bankAccountId,
                        receivedOn,
                    },
                };
                scope.publish(event);
            } else if (from === 'RECEIVED') {
                await repository.update({ id }, { status: to, receivedOn: null });
                await this.accounts.applyBalanceDelta(
                    scope.manager,
                    earning.bankAccountId,
                    -earning.amountCents,
                );
            } else {
                await repository.update({ id }, { status: to });
            }
        });

        const updated = await this.dataSource
            .getRepository(Earning)
            .findOneOrFail({ where: { id }, relations: { earningType: true } });

        return updated as EarningWithType;
    }

    /**
     * Varredura de vencidas (job do FCB-015; sem rota): um único `UPDATE` leva a
     * `OVERDUE` toda receita `OPEN` esperada antes de `asOf`, no dia de negócio, e
     * devolve quantas mudou. Idempotente: a segunda chamada não encontra `OPEN`.
     */
    async markOverdue(asOf: Date): Promise<number> {
        const result = await this.dataSource
            .createQueryBuilder()
            .update(Earning)
            .set({ status: 'OVERDUE' })
            .where('status = :open AND occurred_on < :asOf', {
                open: 'OPEN',
                asOf: businessToday(asOf),
            })
            .execute();

        return result.affected ?? 0;
    }
}
