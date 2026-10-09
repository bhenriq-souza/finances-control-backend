import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses } from '../platform';
import { toRecurrenceResponse } from './expense-recurrence.response';
import {
    ExpenseRecurrenceServiceSymbol,
    type ExpenseRecurrenceService,
} from './expense-recurrence.service';
import {
    endRecurrenceSchema,
    expenseIdParamsSchema,
    listRecurrencesQuerySchema,
} from './expense.schemas';

@injectable()
export class ExpenseRecurrenceController {
    constructor(
        @inject(ExpenseRecurrenceServiceSymbol) private readonly service: ExpenseRecurrenceService,
    ) {}

    async handleListRecurrences(req: Request, res: Response): Promise<Response> {
        const query = listRecurrencesQuerySchema.parse(req.query);

        return HttpResponses.ok(res, (await this.service.list(query)).map(toRecurrenceResponse));
    }

    async handleGetRecurrence(req: Request, res: Response): Promise<Response> {
        const { id } = expenseIdParamsSchema.parse(req.params);

        return HttpResponses.ok(res, toRecurrenceResponse(await this.service.findById(id)));
    }

    async handleEndRecurrence(req: Request, res: Response): Promise<Response> {
        const { id } = expenseIdParamsSchema.parse(req.params);
        const change = endRecurrenceSchema.parse(req.body);

        return HttpResponses.ok(res, toRecurrenceResponse(await this.service.end(id, change)));
    }
}
