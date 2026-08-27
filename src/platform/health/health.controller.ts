import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses } from '../http/http-responses';
import { HealthServiceSymbol } from '../symbols';
import type { HealthService } from './health.service';

@injectable()
export class HealthController {
    constructor(@inject(HealthServiceSymbol) private readonly service: HealthService) {}

    handleGetHealth(_req: Request, res: Response): Response {
        return HttpResponses.ok(res, this.service.getReport());
    }
}
