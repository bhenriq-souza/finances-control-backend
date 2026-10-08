import { inject, injectable } from 'tsyringe';
import { IsNull, type EntityManager } from 'typeorm';

import { CreditCardServiceSymbol, type CreditCard, type CreditCardService } from '../accounts';
import { STATEMENT_CLOSED, STATEMENT_PAID } from '../events';
import { ExpenseServiceSymbol, type ExpenseService } from '../expenses';
import {
    TransactionRunnerSymbol,
    businessToday,
    type TransactionRunner,
    type TransactionScope,
} from '../platform';
import { CreditCardRefund } from './credit-card-refund.entity';
import { CreditCardStatementPayment } from './credit-card-statement-payment.entity';
import { CreditCardStatement } from './credit-card-statement.entity';
import { firstCycle, nextCycle } from './statement-chain';

/** Expense statuses that count toward a statement total (spec 0013, Valores de uma fatura). */
const COUNTED_STATUSES: readonly string[] = ['OPEN', 'VERIFYING', 'PAID'];

/** Midnight UTC of a `YYYY-MM-DD` date, the form `cycleFor` works with. */
const utcDay = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** Noon UTC keeps the day stable when the expenses interface re-reads it in business time. */
const noon = (iso: string): Date => new Date(`${iso}T12:00:00.000Z`);

const isoOf = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Takes the per-card advisory lock every write of this module on a card takes
 * (spec 0013, Fechamento). Transaction-scoped: released at commit or rollback.
 */
export const lockCreditCard = async (
    manager: EntityManager,
    creditCardId: string,
): Promise<void> => {
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [
        creditCardId,
    ]);
};

@injectable()
export class StatementService {
    constructor(
        @inject(TransactionRunnerSymbol) private readonly runner: TransactionRunner,
        @inject(CreditCardServiceSymbol) private readonly creditCards: CreditCardService,
        @inject(ExpenseServiceSymbol) private readonly expenses: ExpenseService,
    ) {}

    /**
     * Registers, for one card or for all of them, every chained cycle whose `closesOn` is
     * before `asOf` (business date) and has no row yet, in chronological order. Each card
     * runs in its own transaction under its advisory lock; returns how many statements were
     * registered (INV-0013-07, INV-0013-08).
     */
    async closeDue(asOf: Date, creditCardId?: string): Promise<number> {
        const asOfIso = businessToday(asOf);
        const cardIds =
            creditCardId !== undefined
                ? [creditCardId]
                : (await this.creditCards.list({ archived: 'true' })).map((card) => card.id);
        let registered = 0;

        for (const id of cardIds) {
            registered += await this.runner.run((scope) => this.closeCard(scope, id, asOfIso));
        }

        return registered;
    }

    private async closeCard(
        scope: TransactionScope,
        creditCardId: string,
        asOfIso: string,
    ): Promise<number> {
        const { manager } = scope;

        await lockCreditCard(manager, creditCardId);

        // Read under the lock: a concurrent call has already committed its rows by now.
        const card = await this.creditCards.findById(creditCardId);
        const statements = await manager.getRepository(CreditCardStatement).find({
            where: { creditCardId },
            order: { closesOn: 'ASC' },
        });
        let count = 0;

        for (;;) {
            const previous = statements.at(-1) ?? null;
            const cycle = previous
                ? nextCycle(card, utcDay(previous.closesOn))
                : firstCycle(card, utcDay(businessToday(card.createdAt)));

            if (isoOf(cycle.closesOn) >= asOfIso) break;

            statements.push(
                await this.register(scope, card, statements, {
                    startsOn: isoOf(cycle.startsOn),
                    closesOn: isoOf(cycle.closesOn),
                    dueOn: isoOf(cycle.dueOn),
                }),
            );
            count += 1;
        }

        return count;
    }

    /** Writes statement `N` and applies the roll-over rules of spec 0013, Fechamento. */
    private async register(
        scope: TransactionScope,
        card: CreditCard,
        statements: CreditCardStatement[],
        cycle: { startsOn: string; closesOn: string; dueOn: string },
    ): Promise<CreditCardStatement> {
        const { manager } = scope;
        const repository = manager.getRepository(CreditCardStatement);
        const payments = manager.getRepository(CreditCardStatementPayment);
        const previous = statements.at(-1) ?? null;
        let previousBalanceCents = 0;

        if (previous) {
            const remaining = await this.remainingOf(manager, card.id, previous);

            if (previous.status === 'CLOSED') {
                previousBalanceCents = remaining;
                await repository.update({ id: previous.id }, { status: 'ROLLED_OVER' });
                previous.status = 'ROLLED_OVER';
            } else if (previous.status === 'PAID' && remaining < 0) {
                previousBalanceCents = remaining;
            }
        }

        const earlyPayments = await payments.find({
            where: { creditCardId: card.id, statementId: IsNull() },
            order: { paidOn: 'ASC', createdAt: 'ASC' },
        });
        const totalCents = await this.totalOf(manager, card.id, cycle.startsOn, cycle.closesOn);
        const amountDueCents = totalCents + previousBalanceCents;
        const paidCents = earlyPayments.reduce((sum, payment) => sum + payment.amountCents, 0);
        const paidInFull = amountDueCents - paidCents <= 0;

        const saved = await repository.save(
            repository.create({
                creditCardId: card.id,
                ...cycle,
                status: paidInFull ? 'PAID' : 'CLOSED',
                previousBalanceCents,
                minimumPaymentCents: null,
                closedAt: new Date(),
            }),
        );

        if (earlyPayments.length > 0) {
            await payments.update(
                { creditCardId: card.id, statementId: IsNull() },
                { statementId: saved.id },
            );
        }

        scope.publish({
            name: STATEMENT_CLOSED,
            payload: {
                statementId: saved.id,
                creditCardId: card.id,
                startsOn: saved.startsOn,
                closesOn: saved.closesOn,
                dueOn: saved.dueOn,
                totalCents,
                previousBalanceCents,
                amountDueCents,
            },
        });

        if (paidInFull) {
            // The chain is the statement's own window plus the ROLLED_OVER ones right before it.
            let chainStart = saved.startsOn;

            for (let index = statements.length - 1; index >= 0; index -= 1) {
                const candidate = statements[index]!;

                if (candidate.status !== 'ROLLED_OVER') break;
                chainStart = candidate.startsOn;
            }

            const paidOn = earlyPayments.at(-1)?.paidOn ?? saved.closesOn;

            await this.expenses.markPaidByStatement(
                manager,
                card.id,
                { from: noon(chainStart), to: noon(saved.closesOn) },
                noon(paidOn),
            );
            scope.publish({
                name: STATEMENT_PAID,
                payload: { statementId: saved.id, creditCardId: card.id, paidOn },
            });
        }

        return saved;
    }

    /** `purchasesCents - refundsCents` of the window; nothing is stored (INV-0013-02). */
    private async totalOf(
        manager: EntityManager,
        creditCardId: string,
        startsOn: string,
        closesOn: string,
    ): Promise<number> {
        const expenses = await this.expenses.listByCreditCard(creditCardId, {
            from: noon(startsOn),
            to: noon(closesOn),
        });
        const purchases = expenses
            .filter((expense) => COUNTED_STATUSES.includes(expense.status))
            .reduce((sum, expense) => sum + expense.amountCents, 0);
        const refunds = await manager
            .getRepository(CreditCardRefund)
            .createQueryBuilder('r')
            .where('r.creditCardId = :creditCardId', { creditCardId })
            .andWhere('r.postedOn >= :startsOn', { startsOn })
            .andWhere('r.postedOn <= :closesOn', { closesOn })
            .getMany();

        return purchases - refunds.reduce((sum, refund) => sum + refund.amountCents, 0);
    }

    /** `amountDueCents - paidCents` of a persisted statement, right now. */
    private async remainingOf(
        manager: EntityManager,
        creditCardId: string,
        statement: CreditCardStatement,
    ): Promise<number> {
        const totalCents = await this.totalOf(
            manager,
            creditCardId,
            statement.startsOn,
            statement.closesOn,
        );
        const payments = await manager
            .getRepository(CreditCardStatementPayment)
            .find({ where: { statementId: statement.id } });
        const paidCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0);

        return totalCents + statement.previousBalanceCents - paidCents;
    }
}
