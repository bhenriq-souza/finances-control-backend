import { ScopeTypes } from '@bhs-dev/typescript-common-types';

import type { ApiModule } from './platform/api/register-api-modules';
import { HealthController } from './platform/health/health.controller';
import { HealthRoutes } from './platform/health/health.routes';
import { HealthService } from './platform/health/health.service';
import {
    HealthControllerSymbol,
    HealthRoutesSymbol,
    HealthServiceSymbol,
} from './platform/symbols';
import {
    BankController,
    BankControllerSymbol,
    BankRoutes,
    BankRoutesSymbol,
    BankService,
    BankServiceSymbol,
} from './accounts';
import {
    UserController,
    UserControllerSymbol,
    UserRoutes,
    UserRoutesSymbol,
    UserService,
    UserServiceSymbol,
} from './identity';

/**
 * Módulos publicados pela API. Cada módulo de domínio (ADR-0003) entra aqui com
 * seu prefixo e suas dependências.
 *
 * Esta lista vive na raiz de `src/`, e não em `platform/`, porque é composição:
 * ela precisa conhecer os módulos de domínio, e `platform` não pode conhecê-los
 * (ADR-0003, regra verificada pelo gate `boundaries`).
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
    {
        path: '/users',
        route: { token: UserRoutesSymbol, clazz: UserRoutes },
        provides: [
            { token: UserServiceSymbol, clazz: UserService, scope: ScopeTypes.SINGLETON },
            { token: UserControllerSymbol, clazz: UserController, scope: ScopeTypes.SINGLETON },
        ],
    },
    {
        path: '/banks',
        route: { token: BankRoutesSymbol, clazz: BankRoutes },
        provides: [
            { token: BankServiceSymbol, clazz: BankService, scope: ScopeTypes.SINGLETON },
            { token: BankControllerSymbol, clazz: BankController, scope: ScopeTypes.SINGLETON },
        ],
    },
];
