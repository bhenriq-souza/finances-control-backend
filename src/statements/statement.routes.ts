import type { RequestHandler } from 'express';
import { inject, injectable } from 'tsyringe';
import type { RouteDef } from '@bhs-dev/typescript-common-types';

import {
    BaseRoute,
    RequireAuthenticationSymbol,
    RequireProfileSymbol,
    USER_PROFILES,
    type RequireProfile,
} from '../platform';
import type { StatementController } from './statement.controller';
import { StatementControllerSymbol } from './statements.symbols';

@injectable()
export class StatementRoutes extends BaseRoute {
    constructor(
        @inject(StatementControllerSymbol) private readonly controller: StatementController,
        @inject(RequireAuthenticationSymbol) private readonly requireAuthentication: RequestHandler,
        @inject(RequireProfileSymbol) private readonly requireProfile: RequireProfile,
    ) {
        super();
    }

    routes(): RouteDef[] {
        const read = [this.requireAuthentication, this.requireProfile(...USER_PROFILES)];

        // `/current` precisa vir antes de `/:id`, senão o Express lê "current" como id.
        return [
            {
                method: 'GET',
                path: '/',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleListStatements),
            },
            {
                method: 'GET',
                path: '/current',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleGetCurrentStatement),
            },
            {
                method: 'GET',
                path: '/:id',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleGetStatement),
            },
        ];
    }
}
