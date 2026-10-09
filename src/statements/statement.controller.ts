import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses } from '../platform';
import {
    currentStatementQuerySchema,
    listStatementsQuerySchema,
    statementIdParamsSchema,
} from './statement.schemas';
import { StatementService } from './statement.service';

@injectable()
export class StatementController {
    constructor(@inject(StatementService) private readonly service: StatementService) {}

    async handleListStatements(req: Request, res: Response): Promise<Response> {
        const query = listStatementsQuerySchema.parse(req.query);

        return HttpResponses.ok(res, await this.service.list(query));
    }

    async handleGetCurrentStatement(req: Request, res: Response): Promise<Response> {
        const { creditCardId } = currentStatementQuerySchema.parse(req.query);

        return HttpResponses.ok(res, await this.service.current(creditCardId));
    }

    async handleGetStatement(req: Request, res: Response): Promise<Response> {
        const { id } = statementIdParamsSchema.parse(req.params);

        return HttpResponses.ok(res, await this.service.findById(id));
    }
}
