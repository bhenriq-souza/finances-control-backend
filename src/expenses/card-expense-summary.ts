import type { ExpenseStatus } from './expense-status';

/** Despesa de cartão como a fatura a vê (spec 0013, Interface pública que esta spec acrescenta). */
export type CardExpenseSummary = {
    id: string;
    description: string;
    occurredOn: string;
    postedOn: string;
    amountCents: number;
    status: ExpenseStatus;
    expenseType: { id: string; name: string };
    installment: { groupId: string; number: number; total: number } | null;
};
