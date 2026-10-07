import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import type { DataSource } from 'typeorm';

import { BankAccountService, BankAccountServiceSymbol } from '../accounts';
import { EARNING_CREATED, type EarningCreated } from '../events';
import { DatabaseConnectionSymbol, TransactionRunnerSymbol } from '../platform';
import type { TransactionRunner } from '../platform';
import { Earning } from './earning.entity';
import { EarningTypeServiceSymbol } from './earnings.symbols';
import type { CreateEarningInput } from './earning.schemas';
import type { EarningTypeService } from './earning-type.service';

export type EarningWithType = Earning & { earningType: NonNullable<Earning['earningType']> };

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
}
