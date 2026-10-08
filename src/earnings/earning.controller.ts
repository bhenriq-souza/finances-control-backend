import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses } from '../platform';
import { toEarningResponse } from './earning.response';
import {
    changeEarningStatusSchema,
    createEarningSchema,
    earningIdParamsSchema,
    listEarningsQuerySchema,
    updateEarningSchema,
} from './earning.schemas';
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

    async handleChangeStatus(req: Request, res: Response): Promise<Response> {
        const { id } = earningIdParamsSchema.parse(req.params);
        const data = changeEarningStatusSchema.parse(req.body);
        const earning = await this.service.changeStatus(id, data);

        return HttpResponses.ok(res, toEarningResponse(earning));
    }

    async handleListEarnings(req: Request, res: Response): Promise<Response> {
        const query = listEarningsQuerySchema.parse(req.query);
        const earnings = await this.service.list(query);

        return HttpResponses.ok(res, earnings.map(toEarningResponse));
    }

    async handleGetEarning(req: Request, res: Response): Promise<Response> {
        const { id } = earningIdParamsSchema.parse(req.params);

        return HttpResponses.ok(res, toEarningResponse(await this.service.findById(id)));
    }

    async handleUpdateEarning(req: Request, res: Response): Promise<Response> {
        const { id } = earningIdParamsSchema.parse(req.params);
        const changes = updateEarningSchema.parse(req.body);

        return HttpResponses.ok(res, toEarningResponse(await this.service.update(id, changes)));
    }

    async handleDeleteEarning(req: Request, res: Response): Promise<Response> {
        const { id } = earningIdParamsSchema.parse(req.params);

        await this.service.delete(id);

        return HttpResponses.noContent(res);
    }
}
