/** Estados da despesa. Persistido como `text` sob CHECK (spec 0010). */
export const EXPENSE_STATUSES = ['OPEN', 'FORECAST', 'PAID', 'OVERDUE', 'VERIFYING'] as const;

export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
