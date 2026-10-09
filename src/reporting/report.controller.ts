import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses } from '../platform';
import { balanceQuerySchema } from './balance.schemas';
import type { BalanceReportService } from './balance-report.service';
import { byTypeQuerySchema } from './by-type.schemas';
import type { ByTypeReportService } from './by-type.service';
import { BalanceReportServiceSymbol, ByTypeReportServiceSymbol } from './reporting.symbols';

@injectable()
export class ReportController {
    constructor(
        @inject(ByTypeReportServiceSymbol) private readonly byType: ByTypeReportService,
        @inject(BalanceReportServiceSymbol) private readonly balance: BalanceReportService,
    ) {}

    async handleBalance(req: Request, res: Response): Promise<Response> {
        const query = balanceQuerySchema.parse(req.query);

        return HttpResponses.ok(res, await this.balance.balance(query));
    }

    async handleExpensesByType(req: Request, res: Response): Promise<Response> {
        const query = byTypeQuerySchema.parse(req.query);

        return HttpResponses.ok(res, await this.byType.expensesByType(query));
    }

    async handleEarningsByType(req: Request, res: Response): Promise<Response> {
        const query = byTypeQuerySchema.parse(req.query);

        return HttpResponses.ok(res, await this.byType.earningsByType(query));
    }
}
