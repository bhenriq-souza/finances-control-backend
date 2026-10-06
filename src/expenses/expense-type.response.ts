import type { ExpenseType } from './expense-type.entity';

export type ExpenseTypeResponse = {
    id: string;
    name: string;
    archivedAt: string | null;
    createdAt: string;
};

export const toExpenseTypeResponse = (type: ExpenseType): ExpenseTypeResponse => ({
    id: type.id,
    name: type.name,
    archivedAt: type.archivedAt?.toISOString() ?? null,
    createdAt: type.createdAt.toISOString(),
});
