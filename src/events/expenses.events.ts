import type { DomainEvent } from '../platform';

/** Publicado uma vez por linha de despesa criada (spec 0012, AC-0012-19). */
export const EXPENSE_CREATED = 'ExpenseCreated' as const;
export type ExpenseCreated = DomainEvent<
    typeof EXPENSE_CREATED,
    {
        expenseId: string;
        kind: 'FIXED' | 'VARIABLE' | 'INSTALLMENT';
        status: 'OPEN' | 'FORECAST' | 'VERIFYING';
        amountCents: number;
        occurredOn: string; // ISO date, `YYYY-MM-DD`
        bankAccountId: string | null;
        creditCardId: string | null;
        postedOn: string | null;
        installmentGroupId: string | null;
    }
>;

/** Publicado na transição para `PAID` por esta API, só para despesa de conta. */
export const EXPENSE_PAID = 'ExpensePaid' as const;
export type ExpensePaid = DomainEvent<
    typeof EXPENSE_PAID,
    { expenseId: string; amountCents: number; bankAccountId: string; paidOn: string }
>;
