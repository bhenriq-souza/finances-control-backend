import 'reflect-metadata';
import type { Request, Response } from 'express';

import { HealthController } from '../../../src/platform/health/health.controller';
import type {
    HealthService,
    HealthReport,
    ReadinessReport,
} from '../../../src/platform/health/health.service';

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

    describe('handleGetReady', () => {
        const buildResponse = () => {
            const json = jest.fn();

            return {
                json,
                res: { status: jest.fn().mockReturnValue({ json }) } as unknown as Response,
            };
        };

        it('responde 200 quando a aplicação está pronta (AC-0003-04)', async () => {
            const report: ReadinessReport = { status: 'ready', checks: { database: 'up' } };
            const service = {
                getReadiness: jest.fn().mockResolvedValue(report),
            } as unknown as HealthService;
            const { res, json } = buildResponse();

            await new HealthController(service).handleGetReady({} as Request, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(json).toHaveBeenCalledWith({ data: report });
        });

        it('responde 503 com NOT_READY quando o banco está fora (AC-0003-04)', async () => {
            const report: ReadinessReport = { status: 'not-ready', checks: { database: 'down' } };
            const service = {
                getReadiness: jest.fn().mockResolvedValue(report),
            } as unknown as HealthService;
            const { res, json } = buildResponse();

            await new HealthController(service).handleGetReady({} as Request, res);

            expect(res.status).toHaveBeenCalledWith(503);
            expect(json).toHaveBeenCalledWith({
                error: {
                    message: 'Service not ready',
                    code: 'NOT_READY',
                    details: { checks: { database: 'down' } },
                },
            });
        });
    });
});
