import type { CardExpenseSummary } from '../expenses';
import type { CreditCardRefund } from './credit-card-refund.entity';
import type { CreditCardStatementPayment } from './credit-card-statement-payment.entity';

/** Expense statuses that count toward a statement total (spec 0013, Valores de uma fatura). */
export const COUNTED_STATUSES: readonly string[] = ['OPEN', 'VERIFYING', 'PAID'];

export type StatementViewStatus = 'OPEN' | 'CLOSED' | 'PAID' | 'ROLLED_OVER';

export type RefundView = {
    id: string;
    creditCardId: string;
    expenseId: string | null;
    description: string;
    amountCents: number;
    occurredOn: string;
    postedOn: string;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
};

export type PaymentView = {
    id: string;
    bankAccountId: string;
    amountCents: number;
    paidOn: string;
    createdAt: string;
};

/** `StatementResponse` (spec 0013, Corpos). */
export type StatementView = {
    id: string | null;
    creditCardId: string;
    status: StatementViewStatus;
    startsOn: string;
    closesOn: string;
    dueOn: string;
    purchasesCents: number;
    refundsCents: number;
    totalCents: number;
    previousBalanceCents: number;
    amountDueCents: number;
    paidCents: number;
    remainingCents: number;
    minimumPaymentCents: number | null;
    overdue: boolean;
    closedAt: string | null;
    byExpenseType: { expenseTypeId: string; name: string; totalCents: number }[];
    expenses?: CardExpenseSummary[];
    refunds?: RefundView[];
    payments?: PaymentView[];
};

/** What defines a statement before its values are derived from the postings. */
export type StatementBase = {
    id: string | null;
    creditCardId: string;
    status: StatementViewStatus;
    startsOn: string;
    closesOn: string;
    dueOn: string;
    previousBalanceCents: number;
    minimumPaymentCents: number | null;
    closedAt: Date | null;
    payments: CreditCardStatementPayment[];
    /** The open statement of today: its balance and payments are provisional. */
    current: boolean;
};

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

/**
 * Derives every value of a statement from its postings; nothing here is stored
 * (INV-0013-02). `expenses` and `refunds` are already the ones of the window.
 */
export function summarizeStatement(
    base: StatementBase,
    expenses: CardExpenseSummary[],
    refunds: CreditCardRefund[],
    today: string,
    detail: boolean,
): StatementView {
    const counted = expenses.filter((expense) => COUNTED_STATUSES.includes(expense.status));
    const purchasesCents = sum(counted.map((expense) => expense.amountCents));
    const refundsCents = sum(refunds.map((refund) => refund.amountCents));
    const totalCents = purchasesCents - refundsCents;
    const amountDueCents = totalCents + base.previousBalanceCents;
    const paidCents = sum(base.payments.map((payment) => payment.amountCents));
    const remainingCents = amountDueCents - paidCents;
    const threshold = base.minimumPaymentCents ?? amountDueCents;

    const groups = new Map<string, { expenseTypeId: string; name: string; totalCents: number }>();

    for (const expense of counted) {
        const group = groups.get(expense.expenseType.id) ?? {
            expenseTypeId: expense.expenseType.id,
            name: expense.expenseType.name,
            totalCents: 0,
        };

        group.totalCents += expense.amountCents;
        groups.set(group.expenseTypeId, group);
    }

    const view: StatementView = {
        id: base.id,
        creditCardId: base.creditCardId,
        status: base.status,
        startsOn: base.startsOn,
        closesOn: base.closesOn,
        dueOn: base.dueOn,
        purchasesCents,
        refundsCents,
        totalCents,
        previousBalanceCents: base.previousBalanceCents,
        amountDueCents,
        paidCents,
        remainingCents,
        minimumPaymentCents: base.minimumPaymentCents,
        overdue: base.status === 'CLOSED' && base.dueOn < today && paidCents < threshold,
        closedAt: base.closedAt ? base.closedAt.toISOString() : null,
        byExpenseType: [...groups.values()].sort(
            (a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name),
        ),
    };

    if (detail) {
        view.expenses = expenses;
        view.refunds = refunds.map((refund) => ({
            id: refund.id,
            creditCardId: refund.creditCardId,
            expenseId: refund.expenseId,
            description: refund.description,
            amountCents: refund.amountCents,
            occurredOn: refund.occurredOn,
            postedOn: refund.postedOn,
            notes: refund.notes,
            createdAt: refund.createdAt.toISOString(),
            updatedAt: refund.updatedAt.toISOString(),
        }));
        view.payments = base.payments.map((payment) => ({
            id: payment.id,
            bankAccountId: payment.bankAccountId,
            amountCents: payment.amountCents,
            paidOn: payment.paidOn,
            createdAt: payment.createdAt.toISOString(),
        }));
    }

    return view;
}
