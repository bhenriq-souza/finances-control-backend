/** Tipos de ocorrência da despesa. Persistido como `text` sob CHECK (spec 0010). */
export const EXPENSE_KINDS = ['FIXED', 'VARIABLE', 'INSTALLMENT'] as const;

export type ExpenseKind = (typeof EXPENSE_KINDS)[number];
