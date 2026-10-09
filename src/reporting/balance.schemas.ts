import { z } from 'zod';

import { refineReportWindow, reportWindowShape } from './report-window.schemas';

/** `GET /reports/balance` (ERR-0015-01 a ERR-0015-03). */
export const balanceQuerySchema = z
    .object({ ...reportWindowShape, bankAccountId: z.uuid().optional() })
    .strict()
    .superRefine(refineReportWindow);

export type BalanceQuery = z.infer<typeof balanceQuerySchema>;
