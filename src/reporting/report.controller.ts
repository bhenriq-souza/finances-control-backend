import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses } from '../platform';
import { byTypeQuerySchema } from './by-type.schemas';
import type { ByTypeReportService } from './by-type.service';
import { ByTypeReportServiceSymbol } from './reporting.symbols';

@injectable()
export class ReportController {
    constructor(@inject(ByTypeReportServiceSymbol) private readonly byType: ByTypeReportService) {}

    async handleExpensesByType(req: Request, res: Response): Promise<Response> {
        const query = byTypeQuerySchema.parse(req.query);

        return HttpResponses.ok(res, await this.byType.expensesByType(query));
    }

    async handleEarningsByType(req: Request, res: Response): Promise<Response> {
        const query = byTypeQuerySchema.parse(req.query);

        return HttpResponses.ok(res, await this.byType.earningsByType(query));
    }
}
