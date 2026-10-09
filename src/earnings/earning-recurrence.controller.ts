import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses } from '../platform';
import { toRecurrenceResponse } from './earning-recurrence.response';
import {
    EarningRecurrenceServiceSymbol,
    type EarningRecurrenceService,
} from './earning-recurrence.service';
import {
    earningIdParamsSchema,
    endRecurrenceSchema,
    listRecurrencesQuerySchema,
} from './earning.schemas';

@injectable()
export class EarningRecurrenceController {
    constructor(
        @inject(EarningRecurrenceServiceSymbol) private readonly service: EarningRecurrenceService,
    ) {}

    async handleListRecurrences(req: Request, res: Response): Promise<Response> {
        const query = listRecurrencesQuerySchema.parse(req.query);

        return HttpResponses.ok(res, (await this.service.list(query)).map(toRecurrenceResponse));
    }

    async handleGetRecurrence(req: Request, res: Response): Promise<Response> {
        const { id } = earningIdParamsSchema.parse(req.params);

        return HttpResponses.ok(res, toRecurrenceResponse(await this.service.findById(id)));
    }

    async handleEndRecurrence(req: Request, res: Response): Promise<Response> {
        const { id } = earningIdParamsSchema.parse(req.params);
        const change = endRecurrenceSchema.parse(req.body);

        return HttpResponses.ok(res, toRecurrenceResponse(await this.service.end(id, change)));
    }
}
