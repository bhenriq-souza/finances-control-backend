import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses, listQuerySchema } from '../platform';
import { EarningTypeServiceSymbol } from './earnings.symbols';
import { toEarningTypeResponse } from './earning-type.response';
import {
    createEarningTypeSchema,
    earningTypeIdParamsSchema,
    updateEarningTypeSchema,
} from './earning-type.schemas';
import type { EarningTypeService } from './earning-type.service';

@injectable()
export class EarningTypeController {
    constructor(@inject(EarningTypeServiceSymbol) private readonly service: EarningTypeService) {}

    async handleListEarningTypes(req: Request, res: Response): Promise<Response> {
        const query = listQuerySchema.parse(req.query);

        const types = await this.service.list(query);

        return HttpResponses.ok(res, types.map(toEarningTypeResponse));
    }

    async handleCreateEarningType(req: Request, res: Response): Promise<Response> {
        const data = createEarningTypeSchema.parse(req.body);
        const type = await this.service.create(data);

        return HttpResponses.created(res, toEarningTypeResponse(type));
    }

    async handleUpdateEarningType(req: Request, res: Response): Promise<Response> {
        const { id } = earningTypeIdParamsSchema.parse(req.params);
        const changes = updateEarningTypeSchema.parse(req.body);

        const type = await this.service.update(id, changes);

        return HttpResponses.ok(res, toEarningTypeResponse(type));
    }

    async handleArchiveEarningType(req: Request, res: Response): Promise<Response> {
        const { id } = earningTypeIdParamsSchema.parse(req.params);

        return HttpResponses.ok(
            res,
            toEarningTypeResponse(await this.service.setArchived(id, true)),
        );
    }

    async handleUnarchiveEarningType(req: Request, res: Response): Promise<Response> {
        const { id } = earningTypeIdParamsSchema.parse(req.params);

        return HttpResponses.ok(
            res,
            toEarningTypeResponse(await this.service.setArchived(id, false)),
        );
    }
}
