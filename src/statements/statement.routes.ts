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
        const write = [this.requireAuthentication, this.requireProfile('ADMIN', 'BILLER')];
        const read = [this.requireAuthentication, this.requireProfile(...USER_PROFILES)];

        // `/current` precisa vir antes de `/:id`, senão o Express lê "current" como id.
        // Vale também para `/current/payments`, que `/:id/payments` engoliria.
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
            {
                method: 'POST',
                path: '/current/payments',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handlePayEarly),
            },
            {
                method: 'DELETE',
                path: '/current/payments/:paymentId',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleUndoEarlyPayment),
            },
            {
                method: 'PATCH',
                path: '/:id',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleUpdateStatement),
            },
            {
                method: 'POST',
                path: '/:id/payments',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handlePayStatement),
            },
            {
                method: 'DELETE',
                path: '/:id/payments/:paymentId',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleUndoStatementPayment),
            },
        ];
    }
}
