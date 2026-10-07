import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses } from '../platform';
import { toEarningResponse } from './earning.response';
import { createEarningSchema } from './earning.schemas';
import type { EarningService } from './earning.service';
import { EarningServiceSymbol } from './earnings.symbols';

@injectable()
export class EarningController {
    constructor(@inject(EarningServiceSymbol) private readonly service: EarningService) {}

    async handleCreateEarning(req: Request, res: Response): Promise<Response> {
        const data = createEarningSchema.parse(req.body);
        const earnings = await this.service.create(data);

        return HttpResponses.created(res, earnings.map(toEarningResponse));
    }
}
