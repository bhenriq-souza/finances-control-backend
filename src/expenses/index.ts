/**
 * Interface pública do módulo `expenses`. Outros módulos importam daqui — nunca
 * de caminho interno (ADR-0003, regra 1; gate `boundaries`).
 */
export { EXPENSE_KINDS, type ExpenseKind } from './expense-kind';
export { EXPENSE_STATUSES, type ExpenseStatus } from './expense-status';
export { ExpenseType } from './expense-type.entity';
export { Expense } from './expense.entity';
export { ExpenseTypeService } from './expense-type.service';
export { ExpenseTypeController } from './expense-type.controller';
export { ExpenseTypeRoutes } from './expense-type.routes';
export { toExpenseTypeResponse, type ExpenseTypeResponse } from './expense-type.response';
export * from './expenses.symbols';
