import 'reflect-metadata';

import { HealthRoutes } from '../../../src/platform/health/health.routes';
import type { HealthController } from '../../../src/platform/health/health.controller';

describe('HealthRoutes', () => {
    const buildRoutes = () =>
        new HealthRoutes({
            handleGetHealth: jest.fn(),
            handleGetReady: jest.fn(),
        } as unknown as HealthController).routes();

    it('declara GET / e delega ao controller', () => {
        const routes = buildRoutes();

        expect(routes[0]).toMatchObject({ method: 'GET', path: '/' });
    });

    it('declara GET /ready separado do liveness (INV-0003-06)', () => {
        const routes = buildRoutes();

        expect(routes).toHaveLength(2);
        expect(routes[1]).toMatchObject({ method: 'GET', path: '/ready' });
    });
});
