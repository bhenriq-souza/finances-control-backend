import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import type { IEnvService, ILogger } from '@bhs-dev/typescript-common-types';

import type { RequestContext } from '../../../src/platform/context/request-context';
import { HealthService } from '../../../src/platform/health/health.service';

describe('HealthService', () => {
    const env: IEnvService = {
        getEnv: (key: string) =>
            ({
                APPLICATION_NAME: 'finances-control-backend',
                APPLICATION_VERSION: '1.2.3',
                ENV: 'dev',
            })[key] ?? '',
    };

    const logger = {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        child: jest.fn(),
    } as unknown as ILogger;

    const requestContext = {
        getCorrelationId: () => 'correlation-id-from-context',
    } as unknown as RequestContext;

    const buildService = (dataSource: Partial<DataSource>) =>
        new HealthService(env, dataSource as DataSource, logger, requestContext);

    describe('getReport (liveness)', () => {
        it('reporta status, identificação da aplicação e uptime', () => {
            const report = buildService({}).getReport();

            expect(report).toMatchObject({
                status: 'ok',
                application: 'finances-control-backend',
                version: '1.2.3',
                environment: 'dev',
            });
            expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(report.uptimeSeconds)).toBe(true);
        });

        it('não toca no banco (INV-0003-06)', () => {
            const query = jest.fn();
            const initialize = jest.fn();

            buildService({ isInitialized: false, query, initialize }).getReport();

            expect(query).not.toHaveBeenCalled();
            expect(initialize).not.toHaveBeenCalled();
        });
    });

    describe('getReadiness', () => {
        it('reporta pronto quando o SELECT 1 responde', async () => {
            const query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);

            const report = await buildService({ isInitialized: true, query }).getReadiness();

            expect(report).toEqual({ status: 'ready', checks: { database: 'up' } });
            expect(query).toHaveBeenCalledWith('SELECT 1');
        });

        it('conecta quando ainda não há conexão (ERR-0003-02)', async () => {
            const initialize = jest.fn().mockResolvedValue(undefined);
            const query = jest.fn().mockResolvedValue([]);

            const report = await buildService({
                isInitialized: false,
                initialize,
                query,
            }).getReadiness();

            expect(initialize).toHaveBeenCalledTimes(1);
            expect(report.checks.database).toBe('up');
        });

        it('reporta não pronto quando a consulta falha', async () => {
            const query = jest.fn().mockRejectedValue(new Error('connection terminated'));

            const report = await buildService({ isInitialized: true, query }).getReadiness();

            expect(report).toEqual({ status: 'not-ready', checks: { database: 'down' } });
        });

        it('reporta não pronto quando a conexão não pode ser aberta', async () => {
            const initialize = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

            const report = await buildService({ isInitialized: false, initialize }).getReadiness();

            expect(report.status).toBe('not-ready');
        });

        it('registra a falha com o correlation-id (ERR-0003-02)', async () => {
            const query = jest.fn().mockRejectedValue(new Error('connection terminated'));

            await buildService({ isInitialized: true, query }).getReadiness();

            expect(logger.error).toHaveBeenCalledWith(
                'readiness probe failed',
                expect.objectContaining({
                    correlationId: 'correlation-id-from-context',
                    error: 'connection terminated',
                }),
            );
        });

        it('registra motivo mesmo quando a rejeição não é um Error', async () => {
            const query = jest.fn().mockRejectedValue('connection lost');

            const report = await buildService({ isInitialized: true, query }).getReadiness();

            expect(report.checks.database).toBe('down');
            expect(logger.error).toHaveBeenCalledWith(
                'readiness probe failed',
                expect.objectContaining({ error: 'connection lost' }),
            );
        });

        it('desiste depois de 2 segundos sem resposta', async () => {
            jest.useFakeTimers();

            // Nunca resolve: simula um banco que aceita a conexão e não responde.
            const query = jest.fn().mockReturnValue(new Promise(() => {}));
            const pending = buildService({ isInitialized: true, query }).getReadiness();

            await jest.advanceTimersByTimeAsync(2_000);

            await expect(pending).resolves.toEqual({
                status: 'not-ready',
                checks: { database: 'down' },
            });

            jest.useRealTimers();
        });

        it('não guarda o resultado entre chamadas', async () => {
            const query = jest
                .fn()
                .mockRejectedValueOnce(new Error('down'))
                .mockResolvedValueOnce([]);
            const service = buildService({ isInitialized: true, query });

            expect((await service.getReadiness()).checks.database).toBe('down');
            expect((await service.getReadiness()).checks.database).toBe('up');
        });
    });
});
