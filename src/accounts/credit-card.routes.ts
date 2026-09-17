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
import { CreditCardControllerSymbol } from './accounts.symbols';
import type { CreditCardController } from './credit-card.controller';

@injectable()
export class CreditCardRoutes extends BaseRoute {
    constructor(
        @inject(CreditCardControllerSymbol) private readonly controller: CreditCardController,
        @inject(RequireAuthenticationSymbol) private readonly requireAuthentication: RequestHandler,
        @inject(RequireProfileSymbol) private readonly requireProfile: RequireProfile,
    ) {
        super();
    }

    routes(): RouteDef[] {
        const write = [this.requireAuthentication, this.requireProfile('ADMIN')];
        const read = [this.requireAuthentication, this.requireProfile(...USER_PROFILES)];

        return [
            {
                method: 'GET',
                path: '/',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleListCreditCards),
            },
            {
                method: 'GET',
                path: '/:id',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleGetCreditCard),
            },
            {
                method: 'POST',
                path: '/',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleCreateCreditCard),
            },
            {
                method: 'PATCH',
                path: '/:id',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleUpdateCreditCard),
            },
        ];
    }
}
