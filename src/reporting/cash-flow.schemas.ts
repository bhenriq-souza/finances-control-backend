import { z } from 'zod';

import { bankAccountIdParam, refineReportWindow, reportWindowShape } from './report-window.schemas';

/** `GET /reports/cash-flow`. */
export const cashFlowQuerySchema = z
    .object({ ...reportWindowShape, bankAccountId: bankAccountIdParam })
    .strict()
    .superRefine(refineReportWindow);

export type CashFlowQuery = z.infer<typeof cashFlowQuerySchema>;
