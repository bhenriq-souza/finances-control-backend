import type { Expense } from './expense.entity';
import { toExpenseTypeResponse, type ExpenseTypeResponse } from './expense-type.response';
import type { ExpenseKind } from './expense-kind';
import type { ExpenseStatus } from './expense-status';

export type ExpenseResponse = {
    id: string;
    description: string;
    kind: ExpenseKind;
    status: ExpenseStatus;
    amountCents: number;
    occurredOn: string;
    paidOn: string | null;
    notes: string | null;
    expenseType: ExpenseTypeResponse;
    bankAccountId: string | null;
    creditCardId: string | null;
    postedOn: string | null;
    installment: { groupId: string; number: number; total: number } | null;
    createdAt: string;
    updatedAt: string;
};

/** Exige a despesa com o tipo carregado: a resposta o publica aninhado. */
export const toExpenseResponse = (
    expense: Expense & { expenseType: NonNullable<Expense['expenseType']> },
): ExpenseResponse => ({
    id: expense.id,
    description: expense.description,
    kind: expense.kind,
    status: expense.status,
    amountCents: expense.amountCents,
    occurredOn: expense.occurredOn,
    paidOn: expense.paidOn,
    notes: expense.notes,
    expenseType: toExpenseTypeResponse(expense.expenseType),
    bankAccountId: expense.bankAccountId,
    creditCardId: expense.creditCardId,
    postedOn: expense.postedOn,
    installment:
        expense.installmentGroupId !== null &&
        expense.installmentNumber !== null &&
        expense.installmentTotal !== null
            ? {
                  groupId: expense.installmentGroupId,
                  number: expense.installmentNumber,
                  total: expense.installmentTotal,
              }
            : null,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
});
