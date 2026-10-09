import { z } from 'zod';

import {
    includeForecastParam,
    refineReportWindow,
    reportWindowShape,
} from './report-window.schemas';

/** `GET /reports/expenses-by-type` e `/earnings-by-type`. */
export const byTypeQuerySchema = z
    .object({ ...reportWindowShape, includeForecast: includeForecastParam })
    .strict()
    .superRefine(refineReportWindow);

export type ByTypeQuery = z.infer<typeof byTypeQuerySchema>;
