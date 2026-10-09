import { CustomError } from '@bhs-dev/typescript-common-errors';
import { inject, injectable } from 'tsyringe';
import { IsNull, type EntityManager } from 'typeorm';
import { ZodError } from 'zod';

import {
    BankAccountServiceSymbol,
    CreditCardServiceSymbol,
    type BankAccountService,
    type CreditCardService,
} from '../accounts';
import { STATEMENT_PAID, STATEMENT_PAYMENT_REGISTERED } from '../events';
import { ExpenseServiceSymbol, type ExpenseService } from '../expenses';
import {
    TransactionRunnerSymbol,
    businessToday,
    type TransactionRunner,
    type TransactionScope,
} from '../platform';
import { CreditCardStatementPayment } from './credit-card-statement-payment.entity';
import { CreditCardStatement } from './credit-card-statement.entity';
import type {
    CreateEarlyPayment,
    CreateStatementPayment,
    UpdateStatement,
} from './statement.schemas';
import { StatementService, lockCreditCard } from './statement.service';
import type { StatementView } from './statement-view';

/** Noon UTC keeps the day stable when the expenses interface re-reads it in business time. */
const noon = (iso: string): Date => new Date(`${iso}T12:00:00.000Z`);

const isoOf = (date: Date): string => date.toISOString().slice(0, 10);

const statementNotFound = (): CustomError =>
    CustomError.notFound('Statement not found', 'STATEMENT_NOT_FOUND', { exposeMessage: true });

const paymentNotFound = (): CustomError =>
    CustomError.notFound('Statement payment not found', 'STATEMENT_PAYMENT_NOT_FOUND', {
        exposeMessage: true,
    });

/** ERR-0013-12: not the last payment, or the next statement is already registered. */
const paymentLocked = (message: string): CustomError =>
    new CustomError(409, 'STATEMENT_PAYMENT_LOCKED', message, { exposeMessage: true });

/** ERR-0013-07: `paidOn` out of the window. */
const invalidPaidOn = (message: string): ZodError =>
    new ZodError([{ code: 'custom', path: ['paidOn'], message, input: undefined }]);

/** ERR-0013-04. */
const exceedsRemaining = (remainingCents: number): CustomError =>
    new CustomError(
        409,
        'STATEMENT_PAYMENT_EXCEEDS_REMAINING',
        `The payment exceeds the remaining amount; remaining: ${Math.max(remainingCents, 0)} cents`,
        { exposeMessage: true },
    );

/** Order "last payment" is decided by: payment date, then creation. */
const byRecency = (a: CreditCardStatementPayment, b: CreditCardStatementPayment): number =>
    a.paidOn.localeCompare(b.paidOn) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id);

type PaymentRecord = {
    creditCardId: string;
    statementId: string | null;
    bankAccountId: string;
    amountCents: number;
    paidOn: string;
    remainingCents: number;
};

@injectable()
export class StatementPaymentService {
    constructor(
        @inject(TransactionRunnerSymbol) private readonly runner: TransactionRunner,
        @inject(CreditCardServiceSymbol) private readonly creditCards: CreditCardService,
        @inject(BankAccountServiceSymbol) private readonly bankAccounts: BankAccountService,
        @inject(ExpenseServiceSymbol) private readonly expenses: ExpenseService,
        @inject(StatementService) private readonly statements: StatementService,
    ) {}

    /**
     * Pays a closed statement: debits the account, releases the limit and, when nothing
     * is left, settles the statement and its chain, all in one transaction under the card
     * lock (INV-0013-06; ERR-0013-03 to ERR-0013-07, ERR-0013-11).
     */
    async pay(id: string, data: CreateStatementPayment): Promise<StatementView> {
        const creditCardId = await this.cardOfStatement(id);

        await this.statements.closeDue(noon(businessToday()), creditCardId);

        await this.runner.run(async (scope) => {
            const { manager } = scope;

            await lockCreditCard(manager, creditCardId);

            const statement = await this.lockedStatement(manager, id);
            const today = businessToday();
            const paidOn = data.paidOn ?? today;

            if (paidOn <= statement.closesOn) {
                throw invalidPaidOn('paidOn must be after the statement closing date');
            }
            if (paidOn > today) throw invalidPaidOn('paidOn must not be in the future');

            if (statement.status === 'PAID') {
                throw new CustomError(409, 'STATEMENT_ALREADY_PAID', 'The statement is paid', {
                    exposeMessage: true,
                });
            }
            if (statement.status === 'ROLLED_OVER') {
                throw new CustomError(
                    409,
                    'STATEMENT_ROLLED_OVER',
                    'The remaining amount moved to the next statement; pay it there',
                    { exposeMessage: true },
                );
            }

            const remaining = await this.statements.remainingOf(manager, creditCardId, statement);

            if (data.amountCents > remaining) throw exceedsRemaining(remaining);

            await this.assertAccountIsUsable(data.bankAccountId);

            const payment = await this.record(scope, {
                creditCardId,
                statementId: statement.id,
                bankAccountId: data.bankAccountId,
                amountCents: data.amountCents,
                paidOn,
                remainingCents: remaining - data.amountCents,
            });

            if (remaining - data.amountCents === 0) {
                await manager
                    .getRepository(CreditCardStatement)
                    .update({ id: statement.id }, { status: 'PAID' });
                await this.expenses.markPaidByStatement(
                    manager,
                    creditCardId,
                    {
                        from: noon(await this.chainStart(manager, statement)),
                        to: noon(statement.closesOn),
                    },
                    noon(payment.paidOn),
                );
                scope.publish({
                    name: STATEMENT_PAID,
                    payload: { statementId: statement.id, creditCardId, paidOn: payment.paidOn },
                });
            }
        });

        return this.statements.findById(id);
    }

    /**
     * Pays the open statement ahead of its closing: same effects on account and limit, but
     * the payment has no statement yet and no expense is marked as paid (INV-0013-14;
     * ERR-0013-04, ERR-0013-07, ERR-0013-17).
     */
    async payEarly(data: CreateEarlyPayment): Promise<StatementView> {
        const { creditCardId } = data;

        await this.creditCards.findById(creditCardId);
        await this.statements.closeDue(noon(businessToday()), creditCardId);

        await this.runner.run(async (scope) => {
            const { manager } = scope;

            await lockCreditCard(manager, creditCardId);

            const card = await this.creditCards.findById(creditCardId);
            const { persisted, current } = await this.statements.chainOf(manager, card);
            const pending = persisted.find((statement) => statement.status === 'CLOSED');

            if (pending) {
                throw new CustomError(
                    409,
                    'STATEMENT_PREVIOUS_UNPAID',
                    `A closed statement is still unpaid: ${pending.id}`,
                    { exposeMessage: true },
                );
            }

            const startsOn = isoOf(current.startsOn);
            const today = businessToday();
            const paidOn = data.paidOn ?? today;

            if (paidOn < startsOn) {
                throw invalidPaidOn('paidOn must not be before the open statement start');
            }
            if (paidOn > today) throw invalidPaidOn('paidOn must not be in the future');

            const early = await manager
                .getRepository(CreditCardStatementPayment)
                .find({ where: { creditCardId, statementId: IsNull() } });
            const total = await this.statements.totalOf(
                manager,
                creditCardId,
                startsOn,
                isoOf(current.closesOn),
            );
            const remaining = total - early.reduce((sum, payment) => sum + payment.amountCents, 0);

            if (data.amountCents > remaining) throw exceedsRemaining(remaining);

            await this.assertAccountIsUsable(data.bankAccountId);
            await this.record(scope, {
                creditCardId,
                statementId: null,
                bankAccountId: data.bankAccountId,
                amountCents: data.amountCents,
                paidOn,
                remainingCents: remaining - data.amountCents,
            });
        });

        return this.statements.current(creditCardId);
    }

    /** `PATCH /statements/:id`: the informed minimum, with no rule on its value. */
    async update(id: string, changes: UpdateStatement): Promise<StatementView> {
        await this.runner.run(async ({ manager }) => {
            const repository = manager.getRepository(CreditCardStatement);
            const found = await repository.findOne({
                where: { id },
                lock: { mode: 'for_no_key_update' },
            });

            if (!found) throw statementNotFound();

            await repository.update({ id }, { minimumPaymentCents: changes.minimumPaymentCents });
        });

        return this.statements.findById(id);
    }

    /**
     * Undoes the last payment of a statement while the next one is not registered, in
     * reverse order: status and chain, account, limit, payment (ERR-0013-12). No event.
     */
    async undo(id: string, paymentId: string): Promise<void> {
        const creditCardId = await this.cardOfStatement(id);

        await this.statements.closeDue(noon(businessToday()), creditCardId);

        await this.runner.run(async ({ manager }) => {
            await lockCreditCard(manager, creditCardId);

            const statement = await this.lockedStatement(manager, id);
            const payments = await manager
                .getRepository(CreditCardStatementPayment)
                .find({ where: { statementId: id } });
            const payment = payments.find((candidate) => candidate.id === paymentId);

            if (!payment) throw paymentNotFound();

            if ([...payments].sort(byRecency).at(-1)!.id !== payment.id) {
                throw paymentLocked('Only the last payment of the statement can be undone');
            }

            const next = await manager
                .getRepository(CreditCardStatement)
                .createQueryBuilder('s')
                .where('s.creditCardId = :creditCardId', { creditCardId })
                .andWhere('s.startsOn > :closesOn', { closesOn: statement.closesOn })
                .getOne();

            if (next) throw paymentLocked('The next statement is already registered');

            await this.revert(manager, payment);

            if (statement.status !== 'PAID') return;

            // With the payment gone: a credit-only statement (remaining <= 0) stays settled.
            const remaining = await this.statements.remainingOf(manager, creditCardId, statement);

            if (remaining <= 0) return;

            await manager.getRepository(CreditCardStatement).update({ id }, { status: 'CLOSED' });
            await this.expenses.markUnpaidByStatement(manager, creditCardId, {
                from: noon(await this.chainStart(manager, statement)),
                to: noon(statement.closesOn),
            });
        });
    }

    /** Undoes the last early payment of a card before its statement is registered. */
    async undoEarly(creditCardId: string, paymentId: string): Promise<void> {
        await this.creditCards.findById(creditCardId);
        await this.statements.closeDue(noon(businessToday()), creditCardId);

        await this.runner.run(async ({ manager }) => {
            await lockCreditCard(manager, creditCardId);

            const payments = await manager
                .getRepository(CreditCardStatementPayment)
                .find({ where: { creditCardId, statementId: IsNull() } });
            const payment = payments.find((candidate) => candidate.id === paymentId);

            if (!payment) throw paymentNotFound();

            if ([...payments].sort(byRecency).at(-1)!.id !== payment.id) {
                throw paymentLocked('Only the last early payment of the card can be undone');
            }

            await this.revert(manager, payment);
        });
    }

    /** Payment gone, account back, limit consumed: the inverse of `record`. */
    private async revert(
        manager: EntityManager,
        payment: CreditCardStatementPayment,
    ): Promise<void> {
        await manager.getRepository(CreditCardStatementPayment).delete({ id: payment.id });
        await this.bankAccounts.applyBalanceDelta(
            manager,
            payment.bankAccountId,
            payment.amountCents,
        );
        await this.creditCards.applyAvailableLimitDelta(
            manager,
            payment.creditCardId,
            -payment.amountCents,
        );
    }

    /** Steps 2 to 5 of a payment: row, account, limit and event. */
    private async record(
        scope: TransactionScope,
        data: PaymentRecord,
    ): Promise<CreditCardStatementPayment> {
        const { manager } = scope;
        const repository = manager.getRepository(CreditCardStatementPayment);
        const saved = await repository.save(
            repository.create({
                creditCardId: data.creditCardId,
                statementId: data.statementId,
                bankAccountId: data.bankAccountId,
                amountCents: data.amountCents,
                paidOn: data.paidOn,
            }),
        );

        await this.bankAccounts.applyBalanceDelta(manager, data.bankAccountId, -data.amountCents);
        await this.creditCards.applyAvailableLimitDelta(
            manager,
            data.creditCardId,
            data.amountCents,
        );
        scope.publish({
            name: STATEMENT_PAYMENT_REGISTERED,
            payload: {
                statementId: data.statementId,
                paymentId: saved.id,
                creditCardId: data.creditCardId,
                bankAccountId: data.bankAccountId,
                amountCents: data.amountCents,
                paidOn: data.paidOn,
                remainingCents: data.remainingCents,
            },
        });

        return saved;
    }

    /** ERR-0013-05 and ERR-0013-06. */
    private async assertAccountIsUsable(bankAccountId: string): Promise<void> {
        const account = await this.bankAccounts.findById(bankAccountId);

        if (account.archivedAt) {
            throw new CustomError(409, 'BANK_ACCOUNT_ARCHIVED', 'This account is archived', {
                exposeMessage: true,
            });
        }
    }

    /** The statement row read under write lock; ERR-0013-01 when missing. */
    private async lockedStatement(
        manager: EntityManager,
        id: string,
    ): Promise<CreditCardStatement> {
        const statement = await manager.getRepository(CreditCardStatement).findOne({
            where: { id },
            lock: { mode: 'for_no_key_update' },
        });

        if (!statement) throw statementNotFound();

        return statement;
    }

    private async cardOfStatement(id: string): Promise<string> {
        const found = await this.runner.run(({ manager }) =>
            manager.getRepository(CreditCardStatement).findOne({ where: { id } }),
        );

        if (!found) throw statementNotFound();

        return found.creditCardId;
    }

    /**
     * First day of the chain of `statement`: its own window plus the `ROLLED_OVER` ones
     * right before it, whose remainder it absorbed. The windows are contiguous.
     */
    private async chainStart(
        manager: EntityManager,
        statement: CreditCardStatement,
    ): Promise<string> {
        const before = await manager
            .getRepository(CreditCardStatement)
            .createQueryBuilder('s')
            .where('s.creditCardId = :creditCardId', { creditCardId: statement.creditCardId })
            .andWhere('s.closesOn < :startsOn', { startsOn: statement.startsOn })
            .orderBy('s.closesOn', 'DESC')
            .getMany();
        let start = statement.startsOn;

        for (const candidate of before) {
            if (candidate.status !== 'ROLLED_OVER') break;
            start = candidate.startsOn;
        }

        return start;
    }
}
