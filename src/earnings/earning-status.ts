/** Status de uma receita (spec 0014, "Vocabulário e status"). */
export const EARNING_STATUSES = ['OPEN', 'FORECAST', 'RECEIVED', 'OVERDUE', 'VERIFYING'] as const;

export type EarningStatus = (typeof EARNING_STATUSES)[number];
