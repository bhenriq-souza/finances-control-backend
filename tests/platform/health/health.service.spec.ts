import 'reflect-metadata';
import type { IEnvService } from '@bhs-dev/typescript-common-types';

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

    it('reporta status, identificação da aplicação e uptime', () => {
        const report = new HealthService(env).getReport();

        expect(report).toMatchObject({
            status: 'ok',
            application: 'finances-control-backend',
            version: '1.2.3',
            environment: 'dev',
        });
        expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(report.uptimeSeconds)).toBe(true);
    });
});
