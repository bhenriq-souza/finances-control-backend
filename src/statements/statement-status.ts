export const STATEMENT_STATUSES = ['CLOSED', 'PAID', 'ROLLED_OVER'] as const;

export type StatementStatus = (typeof STATEMENT_STATUSES)[number];
