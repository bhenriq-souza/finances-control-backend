import { ScopeTypes } from '@bhs-dev/typescript-common-types';

import type { ApiModule } from '../api/register-api-modules';
import { HealthController } from '../health/health.controller';
import { HealthRoutes } from '../health/health.routes';
import { HealthService } from '../health/health.service';
import { HealthControllerSymbol, HealthRoutesSymbol, HealthServiceSymbol } from '../symbols';

/**
 * Módulos publicados pela API. Cada módulo de domínio (ADR-0003) entra aqui
 * com seu prefixo e suas dependências quando nascer.
 */
export const apiModules: ApiModule[] = [
    {
        path: '/health',
        route: { token: HealthRoutesSymbol, clazz: HealthRoutes },
        provides: [
            { token: HealthServiceSymbol, clazz: HealthService, scope: ScopeTypes.SINGLETON },
            { token: HealthControllerSymbol, clazz: HealthController, scope: ScopeTypes.SINGLETON },
        ],
    },
];
