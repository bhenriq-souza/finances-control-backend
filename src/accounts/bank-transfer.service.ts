import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import { ZodError } from 'zod';
import type { EntityManager } from 'typeorm';

import { TRANSFER_COMPLETED } from '../events';
import {
    TransactionRunnerSymbol,
    businessToday,
    type TransactionRunner,
    type TransactionScope,
} from '../platform';
import { BankAccountServiceSymbol } from './accounts.symbols';
import { BankAccount } from './bank-account.entity';
import type { BankAccountService } from './bank-account.service';
import { BankTransfer } from './bank-transfer.entity';
import type { ListBankTransfersQuery, UpdateBankTransfer } from './bank-transfer.schemas';
import type { BankTransferStatus } from './bank-transfer-status';

export type CreateBankTransfer = {
    fromBankAccountId: string;
    toBankAccountId: string;
    amountCents: number;
    occurredOn: string;
    status?: BankTransferStatus;
    completedOn?: string;
    description: string;
    notes?: string;
};

export type ChangeBankTransferStatus = {
    status: BankTransferStatus;
    completedOn?: string;
};

type Movement = Pick<BankTransfer, 'fromBankAccountId' | 'toBankAccountId' | 'amountCents'>;

const transferNotFound = (): CustomError =>
    CustomError.notFound('Bank transfer not found', 'BANK_TRANSFER_NOT_FOUND', {
        exposeMessage: true,
    });

const alreadyCompleted = (): CustomError =>
    new CustomError(
        409,
        'BANK_TRANSFER_ALREADY_COMPLETED',
        'Completed transfers cannot change accounts, amount or date, nor be deleted; undo it first',
        { exposeMessage: true },
    );

@injectable()
export class BankTransferService {
    constructor(
        @inject(TransactionRunnerSymbol) private readonly runner: TransactionRunner,
        @inject(BankAccountServiceSymbol) private readonly accounts: BankAccountService,
    ) {}

    /**
     * Cria a transferência. Concluída (o default), move as duas contas e publica
     * `TransferCompleted` na mesma transação (INV-0018-03); agendada, não move nada.
     */
    create(data: CreateBankTransfer): Promise<BankTransfer> {
        const status = data.status ?? 'COMPLETED';

        return this.runner.run(async (scope) => {
            await this.assertAccountsAreUsable(scope.manager, data);

            const repository = scope.manager.getRepository(BankTransfer);
            const transfer = await repository.save(
                repository.create({
                    fromBankAccountId: data.fromBankAccountId,
                    toBankAccountId: data.toBankAccountId,
                    amountCents: data.amountCents,
                    occurredOn: data.occurredOn,
                    status,
                    completedOn:
                        status === 'COMPLETED' ? (data.completedOn ?? data.occurredOn) : null,
                    description: data.description,
                    notes: data.notes ?? null,
                }),
            );

            if (status === 'COMPLETED') {
                await this.moveBalances(scope.manager, transfer, 1);
                this.publishCompleted(scope, transfer, transfer.completedOn as string);
            }

            return repository.findOneByOrFail({ id: transfer.id });
        });
    }

    /**
     * Conclui (`SCHEDULED → COMPLETED`) ou desfaz (`COMPLETED → SCHEDULED`): as duas
     * contas se movem em sentidos opostos, na mesma transação. Conta arquivada é
     * aceita aqui, como pagar despesa antiga numa conta encerrada.
     */
    changeStatus(id: string, change: ChangeBankTransferStatus): Promise<BankTransfer> {
        return this.runner.run(async (scope) => {
            const repository = scope.manager.getRepository(BankTransfer);
            // Trava a transferência antes das contas: duas mudanças simultâneas de
            // status da mesma transferência não movem o saldo duas vezes.
            const transfer = await repository.findOne({
                where: { id },
                lock: { mode: 'pessimistic_write' },
            });

            if (!transfer) throw transferNotFound();

            if (transfer.status === change.status) {
                throw new CustomError(
                    409,
                    'BANK_TRANSFER_STATUS_UNCHANGED',
                    `Transfer is already ${change.status}`,
                    { exposeMessage: true },
                );
            }

            if (change.status === 'COMPLETED') {
                const completedOn = change.completedOn ?? businessToday();

                await this.moveBalances(scope.manager, transfer, 1);
                await repository.update({ id }, { status: 'COMPLETED', completedOn });
                this.publishCompleted(scope, transfer, completedOn);
            } else {
                await this.moveBalances(scope.manager, transfer, -1);
                await repository.update({ id }, { status: 'SCHEDULED', completedOn: null });
            }

            return repository.findOneByOrFail({ id });
        });
    }

    /** ERR-0018-02 para `:id` inexistente. */
    async findById(id: string): Promise<BankTransfer> {
        const transfer = await this.runner.run((scope) =>
            scope.manager.getRepository(BankTransfer).findOne({ where: { id } }),
        );

        if (!transfer) throw transferNotFound();

        return transfer;
    }

    /** AC-0018-11: `bankAccountId` casa a origem **ou** o destino; `from`/`to` são inclusivos. */
    list(query: ListBankTransfersQuery = {}): Promise<BankTransfer[]> {
        return this.runner.run((scope) => {
            const qb = scope.manager
                .getRepository(BankTransfer)
                .createQueryBuilder('t')
                .orderBy('t.occurredOn', 'ASC')
                .addOrderBy('t.createdAt', 'ASC')
                .addOrderBy('t.id', 'ASC');

            if (query.bankAccountId !== undefined) {
                qb.andWhere(
                    '(t.fromBankAccountId = :accountId OR t.toBankAccountId = :accountId)',
                    { accountId: query.bankAccountId },
                );
            }
            if (query.status !== undefined) qb.andWhere('t.status = :status', query);
            if (query.from !== undefined) qb.andWhere('t.occurredOn >= :from', query);
            if (query.to !== undefined) qb.andWhere('t.occurredOn <= :to', query);

            return qb.getMany();
        });
    }

    /**
     * `description` e `notes` valem sempre; contas, valor e data só em `SCHEDULED`
     * (ERR-0018-06). Agendada não move saldo, então nenhuma conta é tocada.
     */
    update(id: string, changes: UpdateBankTransfer): Promise<BankTransfer> {
        return this.runner.run(async (scope) => {
            const repository = scope.manager.getRepository(BankTransfer);
            const transfer = await repository.findOne({
                where: { id },
                lock: { mode: 'pessimistic_write' },
            });

            if (!transfer) throw transferNotFound();

            const { description, notes, ...movement } = changes;
            const touchesMovement = Object.values(movement).some((value) => value !== undefined);

            if (transfer.status === 'COMPLETED' && touchesMovement) throw alreadyCompleted();

            const from = movement.fromBankAccountId ?? transfer.fromBankAccountId;
            const to = movement.toBankAccountId ?? transfer.toBankAccountId;

            if (from === to) {
                throw new ZodError(
                    (['fromBankAccountId', 'toBankAccountId'] as const).map((field) => ({
                        code: 'custom' as const,
                        path: [field],
                        message: 'fromBankAccountId and toBankAccountId must be different accounts',
                        input: changes,
                    })),
                );
            }

            if (
                movement.fromBankAccountId !== undefined ||
                movement.toBankAccountId !== undefined
            ) {
                await this.assertAccountsAreUsable(scope.manager, {
                    fromBankAccountId: from,
                    toBankAccountId: to,
                });
            }

            const patch: Partial<BankTransfer> = {};
            if (description !== undefined) patch.description = description;
            if (notes !== undefined) patch.notes = notes;
            if (movement.fromBankAccountId !== undefined) patch.fromBankAccountId = from;
            if (movement.toBankAccountId !== undefined) patch.toBankAccountId = to;
            if (movement.amountCents !== undefined) patch.amountCents = movement.amountCents;
            if (movement.occurredOn !== undefined) patch.occurredOn = movement.occurredOn;

            await repository.update({ id }, patch);

            return repository.findOneByOrFail({ id });
        });
    }

    /** Só `SCHEDULED` se exclui (ERR-0018-06): a concluída é desfeita antes. */
    delete(id: string): Promise<void> {
        return this.runner.run(async (scope) => {
            const repository = scope.manager.getRepository(BankTransfer);
            const transfer = await repository.findOne({
                where: { id },
                lock: { mode: 'pessimistic_write' },
            });

            if (!transfer) throw transferNotFound();
            if (transfer.status === 'COMPLETED') throw alreadyCompleted();

            await repository.delete({ id });
        });
    }

    /**
     * `direction` 1 move a origem para baixo e o destino para cima; -1 desfaz.
     * As duas linhas de conta são travadas em ordem crescente de `id`, qualquer que
     * seja o sentido, para que A→B e B→A simultâneas nunca se travem (INV-0018-04).
     */
    private async moveBalances(
        manager: EntityManager,
        transfer: Movement,
        direction: 1 | -1,
    ): Promise<void> {
        const movements = [
            { id: transfer.fromBankAccountId, deltaCents: -transfer.amountCents * direction },
            { id: transfer.toBankAccountId, deltaCents: transfer.amountCents * direction },
        ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

        for (const { id, deltaCents } of movements) {
            await this.accounts.applyBalanceDelta(manager, id, deltaCents);
        }
    }

    private publishCompleted(
        scope: TransactionScope,
        transfer: Movement & Pick<BankTransfer, 'id'>,
        completedOn: string,
    ): void {
        scope.publish({
            name: TRANSFER_COMPLETED,
            payload: {
                transferId: transfer.id,
                fromBankAccountId: transfer.fromBankAccountId,
                toBankAccountId: transfer.toBankAccountId,
                amountCents: transfer.amountCents,
                completedOn,
            },
        });
    }

    /** ERR-0018-03 (inexistente) e ERR-0018-04 (arquivada em qualquer ponta). */
    private async assertAccountsAreUsable(
        manager: EntityManager,
        data: Pick<CreateBankTransfer, 'fromBankAccountId' | 'toBankAccountId'>,
    ): Promise<void> {
        const repository = manager.getRepository(BankAccount);

        for (const id of [data.fromBankAccountId, data.toBankAccountId]) {
            const account = await repository.findOne({ where: { id } });

            if (!account) {
                throw CustomError.notFound('Bank account not found', 'BANK_ACCOUNT_NOT_FOUND', {
                    exposeMessage: true,
                });
            }

            if (account.archivedAt) {
                throw new CustomError(
                    409,
                    'BANK_ACCOUNT_ARCHIVED',
                    'This bank account is archived',
                    { exposeMessage: true },
                );
            }
        }
    }
}
