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
import { EarningTypeControllerSymbol } from './earnings.symbols';
import type { EarningTypeController } from './earning-type.controller';

@injectable()
export class EarningTypeRoutes extends BaseRoute {
    constructor(
        @inject(EarningTypeControllerSymbol) private readonly controller: EarningTypeController,
        @inject(RequireAuthenticationSymbol) private readonly requireAuthentication: RequestHandler,
        @inject(RequireProfileSymbol) private readonly requireProfile: RequireProfile,
    ) {
        super();
    }

    routes(): RouteDef[] {
        // Escrita é de ADMIN e BILLER; leitura, de qualquer perfil (spec 0014).
        const write = [this.requireAuthentication, this.requireProfile('ADMIN', 'BILLER')];
        const read = [this.requireAuthentication, this.requireProfile(...USER_PROFILES)];

        return [
            {
                method: 'GET',
                path: '/',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleListEarningTypes),
            },
            {
                method: 'POST',
                path: '/',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleCreateEarningType),
            },
            {
                method: 'PATCH',
                path: '/:id',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleUpdateEarningType),
            },
            {
                method: 'POST',
                path: '/:id/archive',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleArchiveEarningType),
            },
            {
                method: 'DELETE',
                path: '/:id/archive',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleUnarchiveEarningType),
            },
        ];
    }
}
