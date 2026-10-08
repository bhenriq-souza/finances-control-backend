import { randomUUID } from 'node:crypto';

import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import { In, type DataSource, type FindOptionsWhere, type Repository } from 'typeorm';

import { BankAccountService, BankAccountServiceSymbol } from '../accounts';
import {
    EARNING_CREATED,
    EARNING_RECEIVED,
    type EarningCreated,
    type EarningReceived,
} from '../events';
import {
    DatabaseConnectionSymbol,
    TransactionRunnerSymbol,
    businessToday,
    monthlyInstallmentDates,
    splitCents,
} from '../platform';
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

        // INSTALLMENT: `installmentTotal` linhas, rateadas por `splitCents` e esperadas mês a
        // mês, todas na mesma transação (INV-0014-09); as demais são uma linha.
        const total = input.kind === 'INSTALLMENT' ? (input.installmentTotal ?? 1) : 1;
        const groupId = input.kind === 'INSTALLMENT' ? randomUUID() : null;
        const amounts = splitCents(input.amountCents, total);
        const dates = monthlyInstallmentDates(input.occurredOn, total);

        const ids = await this.transactions.run(async (scope) => {
            const repository = scope.manager.getRepository(Earning);
            const created: string[] = [];

            for (let index = 0; index < total; index += 1) {
                const amountCents = amounts[index]!;
                const occurredOn = dates[index]!;
                const saved = await repository.save(
                    repository.create({
                        description: input.description,
                        earningTypeId: input.earningTypeId,
                        kind: input.kind,
                        status,
                        amountCents,
                        occurredOn,
                        receivedOn: null,
                        bankAccountId: input.bankAccountId,
                        installmentGroupId: groupId,
                        installmentNumber: groupId === null ? null : index + 1,
                        installmentTotal: groupId === null ? null : total,
                        notes: input.notes ?? null,
                    }),
                );

                const event: Omit<EarningCreated, 'occurredAt' | 'correlationId'> = {
                    name: EARNING_CREATED,
                    payload: {
                        earningId: saved.id,
                        kind: input.kind,
                        status,
                        amountCents,
                        occurredOn,
                        bankAccountId: input.bankAccountId,
                        installmentGroupId: groupId,
                    },
                };
                scope.publish(event);
                created.push(saved.id);
            }

            return created;
        });

        // Recarrega porque `created_at` é do banco e o INSERT do ORM não a traz.
        const rows = await this.dataSource.getRepository(Earning).find({
            where: { id: In(ids) },
            relations: { earningType: true },
        });
        const byId = new Map(rows.map((row) => [row.id, row]));

        return ids.map((id) => byId.get(id) as EarningWithType);
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
            const locked = await this.lockGroup(repository, id);
            const earning = locked.find((row) => row.id === id);

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

            // Trocar a conta de uma parcela troca a de todas as não recebidas do grupo; as
            // recebidas ficam onde entraram (INV-0014-10). Nada move saldo.
            if (changes.bankAccountId !== undefined) {
                const siblings = locked
                    .filter((row) => row.id !== id && row.status !== 'RECEIVED')
                    .map((row) => row.id);

                if (siblings.length > 0) {
                    await repository.update(
                        { id: In(siblings) },
                        { bankAccountId: changes.bankAccountId },
                    );
                }
            }
        });

        return this.findById(id);
    }

    /**
     * Só receita não recebida se exclui (ERR-0014-10); excluir não move saldo. Numa
     * parcela, exclui na mesma transação todas as não recebidas do grupo; as recebidas
     * ficam (INV-0014-10).
     */
    delete(id: string): Promise<void> {
        return this.transactions.run(async (scope) => {
            const repository = scope.manager.getRepository(Earning);
            const locked = await this.lockGroup(repository, id);
            const target = locked.find((row) => row.id === id);

            if (!target) throw earningNotFound();
            if (target.status === 'RECEIVED') throw alreadyReceived();

            const doomed = locked.filter((row) => row.status !== 'RECEIVED');

            await repository.delete({ id: In(doomed.map((row) => row.id)) });
        });
    }

    /**
     * Leitura sem trava só para descobrir o grupo; a trava vem a seguir, sobre o grupo
     * inteiro em ordem de `id`, para que duas operações sobre parcelas do mesmo grupo nunca
     * se travem em ordem cruzada. `for_no_key_update` por causa do KEY SHARE das FKs.
     * Devolve vazio se `id` não existe.
     */
    private async lockGroup(repository: Repository<Earning>, id: string): Promise<Earning[]> {
        const probe = await repository.findOne({ where: { id } });

        if (!probe) return [];

        const where: FindOptionsWhere<Earning> =
            probe.installmentGroupId !== null
                ? { installmentGroupId: probe.installmentGroupId }
                : { id };

        return repository.find({
            where,
            order: { id: 'ASC' },
            lock: { mode: 'for_no_key_update' },
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
