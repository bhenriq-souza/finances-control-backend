import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import { Between, In, IsNull, type EntityManager } from 'typeorm';
import { ZodError } from 'zod';

import {
    CreditCardServiceSymbol,
    type BillingCycle,
    type CreditCard,
    type CreditCardService,
} from '../accounts';
import { STATEMENT_CLOSED, STATEMENT_PAID } from '../events';
import { ExpenseServiceSymbol, type ExpenseService } from '../expenses';
import {
    TransactionRunnerSymbol,
    addMonths,
    businessToday,
    type TransactionRunner,
    type TransactionScope,
} from '../platform';
import { CreditCardRefund } from './credit-card-refund.entity';
import { CreditCardStatementPayment } from './credit-card-statement-payment.entity';
import { CreditCardStatement } from './credit-card-statement.entity';
import { firstCycle, nextCycle } from './statement-chain';
import type { ListStatementsQuery } from './statement.schemas';
import {
    COUNTED_STATUSES,
    summarizeStatement,
    type StatementBase,
    type StatementView,
} from './statement-view';

/** Largest window `GET /statements` answers: the longest installment plan of spec 0012. */
const MAX_LISTED_STATEMENTS = 120;

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

    /**
     * Statements of a card whose `closesOn` is in `[from, to]`, closed and projected, in
     * `closesOn` order, without postings (spec 0013, Endpoints). Records any overdue closing
     * first (INV-0013-08). Without `from` and `to`: the last twelve months and the open one.
     */
    async list(query: ListStatementsQuery): Promise<StatementView[]> {
        const today = businessToday();

        await this.creditCards.findById(query.creditCardId);
        await this.closeDue(noon(today), query.creditCardId);

        return this.runner.run(async ({ manager }) => {
            const card = await this.creditCards.findById(query.creditCardId);
            const { persisted, current } = await this.chainOf(manager, card);
            const currentClosesOn = isoOf(current.closesOn);
            const to =
                query.to ??
                (query.from !== undefined && query.from > currentClosesOn
                    ? query.from
                    : currentClosesOn);
            const lowerDefault = addMonths(today, -12);
            const from = query.from ?? (lowerDefault <= to ? lowerDefault : to);
            const bases: StatementBase[] = persisted
                .filter((row) => row.closesOn >= from && row.closesOn <= to)
                .map((row) => this.persistedBase(row));
            let cycle = current;

            while (isoOf(cycle.closesOn) <= to) {
                if (isoOf(cycle.closesOn) >= from) {
                    bases.push(this.projectedBase(card.id, cycle, cycle === current));
                }

                if (bases.length > MAX_LISTED_STATEMENTS) break;

                cycle = nextCycle(card, cycle.closesOn);
            }

            if (bases.length > MAX_LISTED_STATEMENTS) {
                throw new ZodError([
                    {
                        code: 'custom',
                        path: ['to'],
                        message: `The window must not cover more than ${MAX_LISTED_STATEMENTS} statements`,
                        input: undefined,
                    },
                ]);
            }

            return this.buildViews(manager, card, persisted, bases, today, false);
        });
    }

    /** The open statement of today, with the detail (`GET /statements/current`). */
    async current(creditCardId: string): Promise<StatementView> {
        const today = businessToday();

        await this.creditCards.findById(creditCardId);
        await this.closeDue(noon(today), creditCardId);

        return this.runner.run(async ({ manager }) => {
            const card = await this.creditCards.findById(creditCardId);
            const { persisted, current } = await this.chainOf(manager, card);
            const [view] = await this.buildViews(
                manager,
                card,
                persisted,
                [this.projectedBase(card.id, current, true)],
                today,
                true,
            );

            return view!;
        });
    }

    /** A persisted statement, with the detail (`GET /statements/:id`). */
    async findById(id: string): Promise<StatementView> {
        const today = businessToday();
        const found = await this.runner.run(({ manager }) =>
            manager.getRepository(CreditCardStatement).findOne({ where: { id } }),
        );

        if (!found) throw statementNotFound();

        await this.closeDue(noon(today), found.creditCardId);

        return this.runner.run(async ({ manager }) => {
            const row = await manager.getRepository(CreditCardStatement).findOne({ where: { id } });

            if (!row) throw statementNotFound();

            const card = await this.creditCards.findById(row.creditCardId);
            const [view] = await this.buildViews(
                manager,
                card,
                [],
                [this.persistedBase(row)],
                today,
                true,
            );

            return view!;
        });
    }

    /** Recorded statements plus the cycle of today, which follows the last of them. */
    private async chainOf(
        manager: EntityManager,
        card: CreditCard,
    ): Promise<{ persisted: CreditCardStatement[]; current: BillingCycle }> {
        const persisted = await manager.getRepository(CreditCardStatement).find({
            where: { creditCardId: card.id },
            order: { closesOn: 'ASC' },
        });
        const last = persisted.at(-1);
        const current = last
            ? nextCycle(card, utcDay(last.closesOn))
            : firstCycle(card, utcDay(businessToday(card.createdAt)));

        return { persisted, current };
    }

    private persistedBase(row: CreditCardStatement): StatementBase {
        return {
            id: row.id,
            creditCardId: row.creditCardId,
            status: row.status,
            startsOn: row.startsOn,
            closesOn: row.closesOn,
            dueOn: row.dueOn,
            previousBalanceCents: row.previousBalanceCents,
            minimumPaymentCents: row.minimumPaymentCents,
            closedAt: row.closedAt,
            payments: [],
            current: false,
        };
    }

    private projectedBase(
        creditCardId: string,
        cycle: BillingCycle,
        current: boolean,
    ): StatementBase {
        return {
            id: null,
            creditCardId,
            status: 'OPEN',
            startsOn: isoOf(cycle.startsOn),
            closesOn: isoOf(cycle.closesOn),
            dueOn: isoOf(cycle.dueOn),
            previousBalanceCents: 0,
            minimumPaymentCents: null,
            closedAt: null,
            payments: [],
            current,
        };
    }

    /**
     * Derives the values of `bases` (ascending by window) from the postings of the card, with
     * one read of expenses, refunds and payments for the whole span. The open statement of
     * today carries the current remaining of the last statement while it is still `CLOSED`,
     * and the early payments (spec 0013, Valores de uma fatura).
     */
    private async buildViews(
        manager: EntityManager,
        card: CreditCard,
        persisted: CreditCardStatement[],
        bases: StatementBase[],
        today: string,
        detail: boolean,
    ): Promise<StatementView[]> {
        if (bases.length === 0) return [];

        const last = persisted.at(-1);
        const needsLast =
            bases.some((base) => base.current) &&
            last?.status === 'CLOSED' &&
            !bases.some((base) => base.id === last.id);
        const all = needsLast ? [this.persistedBase(last), ...bases] : bases;
        const ids = all.flatMap((base) => (base.id === null ? [] : [base.id]));
        const payments = await manager.getRepository(CreditCardStatementPayment).find({
            where: [
                ...(ids.length > 0 ? [{ statementId: In(ids) }] : []),
                ...(all.some((base) => base.current)
                    ? [{ creditCardId: card.id, statementId: IsNull() }]
                    : []),
            ],
            order: { paidOn: 'ASC', createdAt: 'ASC', id: 'ASC' },
        });
        const spanFrom = all[0]!.startsOn;
        const spanTo = all.at(-1)!.closesOn;
        const expenses = await this.expenses.listByCreditCard(
            card.id,
            { from: noon(spanFrom), to: noon(spanTo) },
            manager,
        );
        const refunds = await manager.getRepository(CreditCardRefund).find({
            where: { creditCardId: card.id, postedOn: Between(spanFrom, spanTo) },
            order: { postedOn: 'ASC', createdAt: 'ASC', id: 'ASC' },
        });
        const views: StatementView[] = [];
        let lastView: StatementView | null = null;

        for (const base of all) {
            const own = {
                ...base,
                payments: payments.filter((payment) =>
                    base.id === null
                        ? base.current && payment.statementId === null
                        : payment.statementId === base.id,
                ),
            };

            if (base.current && lastView?.status === 'CLOSED') {
                own.previousBalanceCents = lastView.remainingCents;
            }

            const view = summarizeStatement(
                own,
                expenses.filter(
                    (expense) =>
                        expense.postedOn >= base.startsOn && expense.postedOn <= base.closesOn,
                ),
                refunds.filter(
                    (refund) =>
                        refund.postedOn >= base.startsOn && refund.postedOn <= base.closesOn,
                ),
                today,
                detail,
            );

            if (base.id !== null || base.current) lastView = view;
            if (bases.includes(base)) views.push(view);
        }

        return views;
    }
}

const statementNotFound = (): CustomError =>
    CustomError.notFound('Statement not found', 'STATEMENT_NOT_FOUND', { exposeMessage: true });
