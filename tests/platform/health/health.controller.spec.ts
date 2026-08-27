import 'reflect-metadata';
import type { Request, Response } from 'express';

import { HealthController } from '../../../src/platform/health/health.controller';
import type { HealthService, HealthReport } from '../../../src/platform/health/health.service';

describe('HealthController', () => {
    it('responde 200 com o relatório do serviço', () => {
        const report: HealthReport = {
            status: 'ok',
            application: 'app',
            version: '1.0.0',
            environment: 'test',
            uptimeSeconds: 7,
        };
        const service = {
            getReport: jest.fn().mockReturnValue(report),
        } as unknown as HealthService;

        const json = jest.fn();
        const res = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;

        new HealthController(service).handleGetHealth({} as Request, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({ data: report });
    });
});
