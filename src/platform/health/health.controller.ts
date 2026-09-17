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

    /**
     * 503 quando alguma dependência está fora: é o que tira o pod do balanceamento
     * sem que o kubelet o reinicie.
     */
    async handleGetReady(_req: Request, res: Response): Promise<Response> {
        const report = await this.service.getReadiness();

        if (report.status === 'ready') {
            return HttpResponses.ok(res, report);
        }

        return HttpResponses.fail(res, 503, 'Service not ready', {
            code: 'NOT_READY',
            details: { checks: report.checks },
        });
    }
}
