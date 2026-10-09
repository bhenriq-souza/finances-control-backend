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
import type { CreditCardRefundController } from './credit-card-refund.controller';
import { CreditCardRefundControllerSymbol } from './statements.symbols';

@injectable()
export class CreditCardRefundRoutes extends BaseRoute {
    constructor(
        @inject(CreditCardRefundControllerSymbol)
        private readonly controller: CreditCardRefundController,
        @inject(RequireAuthenticationSymbol) private readonly requireAuthentication: RequestHandler,
        @inject(RequireProfileSymbol) private readonly requireProfile: RequireProfile,
    ) {
        super();
    }

    routes(): RouteDef[] {
        const write = [this.requireAuthentication, this.requireProfile('ADMIN', 'BILLER')];
        const read = [this.requireAuthentication, this.requireProfile(...USER_PROFILES)];

        return [
            {
                method: 'POST',
                path: '/',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleCreateRefund),
            },
            {
                method: 'GET',
                path: '/',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleListRefunds),
            },
            {
                method: 'GET',
                path: '/:id',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleGetRefund),
            },
            {
                method: 'PATCH',
                path: '/:id',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleUpdateRefund),
            },
            {
                method: 'DELETE',
                path: '/:id',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleDeleteRefund),
            },
        ];
    }
}
