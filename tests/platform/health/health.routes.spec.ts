import 'reflect-metadata';

import { HealthRoutes } from '../../../src/platform/health/health.routes';
import type { HealthController } from '../../../src/platform/health/health.controller';

describe('HealthRoutes', () => {
    it('declara GET / e delega ao controller', () => {
        const handleGetHealth = jest.fn();
        const controller = { handleGetHealth } as unknown as HealthController;

        const routes = new HealthRoutes(controller).routes();

        expect(routes).toHaveLength(1);
        expect(routes[0]).toMatchObject({ method: 'GET', path: '/' });
    });
});
