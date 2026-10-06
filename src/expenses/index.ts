/**
 * Interface pública do módulo `expenses`. Outros módulos importam daqui — nunca
 * de caminho interno (ADR-0003, regra 1; gate `boundaries`).
 */
export { EXPENSE_KINDS, type ExpenseKind } from './expense-kind';
export { EXPENSE_STATUSES, type ExpenseStatus } from './expense-status';
export { ExpenseType } from './expense-type.entity';
export { Expense } from './expense.entity';
