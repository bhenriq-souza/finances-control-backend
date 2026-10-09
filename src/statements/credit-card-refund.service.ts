import { CustomError } from '@bhs-dev/typescript-common-errors';
import { inject, injectable } from 'tsyringe';
import type { EntityManager } from 'typeorm';

import { CreditCardServiceSymbol, type CreditCardService } from '../accounts';
import { CREDIT_CARD_REFUND_REGISTERED } from '../events';
import { ExpenseServiceSymbol, type ExpenseService } from '../expenses';
import { TransactionRunnerSymbol, businessToday, type TransactionRunner } from '../platform';
import { CreditCardRefund } from './credit-card-refund.entity';
import type {
    CreateCreditCardRefund,
    ListCreditCardRefundsQuery,
    UpdateCreditCardRefund,
} from './credit-card-refund.schemas';
import { StatementPeriodGuardService } from './statement-period-guard.service';
import { lockCreditCard } from './statement.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The day after a `YYYY-MM-DD` date. */
const nextDay = (iso: string): string =>
    new Date(new Date(`${iso}T00:00:00.000Z`).getTime() + DAY_MS).toISOString().slice(0, 10);

const refundNotFound = (): CustomError =>
    CustomError.notFound('Credit card refund not found', 'CREDIT_CARD_REFUND_NOT_FOUND', {
        exposeMessage: true,
    });

/** ERR-0013-08: the write would change the total of a closed statement window. */
const statementClosed = (closedThrough: string): CustomError =>
    new CustomError(
        409,
        'STATEMENT_CLOSED',
        `The statement window is closed through ${closedThrough}`,
        { exposeMessage: true },
    );

@injectable()
export class CreditCardRefundService {
    constructor(
        @inject(TransactionRunnerSymbol) private readonly runner: TransactionRunner,
        @inject(CreditCardServiceSymbol) private readonly creditCards: CreditCardService,
        @inject(ExpenseServiceSymbol) private readonly expenses: ExpenseService,
        private readonly guard: StatementPeriodGuardService,
    ) {}

    /**
     * Lança um estorno e devolve o valor ao limite do cartão na mesma transação
     * (INV-0013-11). Cartão arquivado aceita. `postedOn` default é
     * `max(occurredOn, closedThrough + 1 dia)`; informado na janela fechada é
     * ERR-0013-08. Com `expenseId`, a despesa é do mesmo cartão (ERR-0013-13) e a soma
     * dos estornos não passa dela (ERR-0013-14).
     */
    create(data: CreateCreditCardRefund): Promise<CreditCardRefund> {
        return this.runner.run(async (scope) => {
            const { manager } = scope;

            await this.creditCards.findById(data.creditCardId);
            await lockCreditCard(manager, data.creditCardId);

            const closedThrough = businessToday(
                await this.guard.closedThrough(manager, data.creditCardId),
            );

            if (data.postedOn !== undefined && data.postedOn <= closedThrough) {
                throw statementClosed(closedThrough);
            }

            const earliestOpen = nextDay(closedThrough);
            const postedOn =
                data.postedOn ?? (data.occurredOn > earliestOpen ? data.occurredOn : earliestOpen);

            if (data.expenseId !== undefined) {
                await this.assertExpenseIsRefundable(
                    data.expenseId,
                    data.creditCardId,
                    data.amountCents,
                    manager,
                );
            }

            const repository = manager.getRepository(CreditCardRefund);
            const saved = await repository.save(
                repository.create({
                    creditCardId: data.creditCardId,
                    expenseId: data.expenseId ?? null,
                    description: data.description,
                    amountCents: data.amountCents,
                    occurredOn: data.occurredOn,
                    postedOn,
                    notes: data.notes ?? null,
                }),
            );

            await this.creditCards.applyAvailableLimitDelta(
                manager,
                saved.creditCardId,
                saved.amountCents,
            );

            scope.publish({
                name: CREDIT_CARD_REFUND_REGISTERED,
                payload: {
                    refundId: saved.id,
                    creditCardId: saved.creditCardId,
                    expenseId: saved.expenseId,
                    amountCents: saved.amountCents,
                    occurredOn: saved.occurredOn,
                    postedOn: saved.postedOn,
                },
            });

            return repository.findOneByOrFail({ id: saved.id });
        });
    }

    /** ERR-0013-01 para `:id` inexistente. */
    async findById(id: string): Promise<CreditCardRefund> {
        const refund = await this.runner.run((scope) =>
            scope.manager.getRepository(CreditCardRefund).findOne({ where: { id } }),
        );

        if (!refund) throw refundNotFound();

        return refund;
    }

    /** Filtros combinados por E; `from`/`to` inclusivos sobre `postedOn`. */
    list(query: ListCreditCardRefundsQuery = {}): Promise<CreditCardRefund[]> {
        return this.runner.run((scope) => {
            const qb = scope.manager
                .getRepository(CreditCardRefund)
                .createQueryBuilder('r')
                .orderBy('r.postedOn', 'ASC')
                .addOrderBy('r.createdAt', 'ASC')
                .addOrderBy('r.id', 'ASC');

            if (query.creditCardId !== undefined) {
                qb.andWhere('r.creditCardId = :creditCardId', query);
            }
            if (query.expenseId !== undefined) qb.andWhere('r.expenseId = :expenseId', query);
            if (query.from !== undefined) qb.andWhere('r.postedOn >= :from', query);
            if (query.to !== undefined) qb.andWhere('r.postedOn <= :to', query);

            return qb.getMany();
        });
    }

    /** Só `description` e `notes`: não muda o total nem o limite, vale na janela fechada. */
    update(id: string, changes: UpdateCreditCardRefund): Promise<CreditCardRefund> {
        return this.runner.run(async (scope) => {
            const repository = scope.manager.getRepository(CreditCardRefund);
            const refund = await repository.findOne({
                where: { id },
                lock: { mode: 'for_no_key_update' },
            });

            if (!refund) throw refundNotFound();

            const patch: Partial<CreditCardRefund> = {};

            if (changes.description !== undefined) patch.description = changes.description;
            if (changes.notes !== undefined) patch.notes = changes.notes;

            await repository.update({ id }, patch);

            return repository.findOneByOrFail({ id });
        });
    }

    /**
     * Exclui o estorno e consome o limite de novo na mesma transação (INV-0013-11).
     * Recusado quando o `postedOn` está na janela fechada (ERR-0013-08).
     */
    delete(id: string): Promise<void> {
        return this.runner.run(async (scope) => {
            const { manager } = scope;
            const repository = manager.getRepository(CreditCardRefund);
            const found = await repository.findOne({ where: { id } });

            if (!found) throw refundNotFound();

            await lockCreditCard(manager, found.creditCardId);

            const refund = await repository.findOne({
                where: { id },
                lock: { mode: 'for_no_key_update' },
            });

            if (!refund) throw refundNotFound();

            const closedThrough = businessToday(
                await this.guard.closedThrough(manager, refund.creditCardId),
            );

            if (refund.postedOn <= closedThrough) throw statementClosed(closedThrough);

            await repository.delete({ id });
            await this.creditCards.applyAvailableLimitDelta(
                manager,
                refund.creditCardId,
                -refund.amountCents,
            );
        });
    }

    /** ERR-0013-05 (via `expenses`), ERR-0013-13 and ERR-0013-14. */
    private async assertExpenseIsRefundable(
        expenseId: string,
        creditCardId: string,
        amountCents: number,
        manager: EntityManager,
    ): Promise<void> {
        const expense = await this.expenses.findById(expenseId);

        if (expense.creditCardId !== creditCardId) {
            throw new CustomError(
                409,
                'REFUND_EXPENSE_MISMATCH',
                'The refunded expense must be a charge of the same credit card',
                { exposeMessage: true },
            );
        }

        const existing = await manager
            .getRepository(CreditCardRefund)
            .find({ where: { expenseId } });
        const refunded = existing.reduce((sum, refund) => sum + refund.amountCents, 0);
        const refundable = expense.amountCents - refunded;

        if (amountCents > refundable) {
            throw new CustomError(
                409,
                'REFUND_EXCEEDS_EXPENSE',
                `The refunds of the expense would exceed its amount; refundable amount: ${refundable} cents`,
                { exposeMessage: true },
            );
        }
    }
}
