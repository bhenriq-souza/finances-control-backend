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
import { EarningControllerSymbol } from './earnings.symbols';
import type { EarningController } from './earning.controller';

@injectable()
export class EarningRoutes extends BaseRoute {
    constructor(
        @inject(EarningControllerSymbol) private readonly controller: EarningController,
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
                handler: this.bind(this.controller, this.controller.handleListEarnings),
            },
            {
                method: 'GET',
                path: '/:id',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleGetEarning),
            },
            {
                method: 'PATCH',
                path: '/:id',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleUpdateEarning),
            },
            {
                method: 'DELETE',
                path: '/:id',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleDeleteEarning),
            },
            {
                method: 'POST',
                path: '/',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleCreateEarning),
            },
            {
                method: 'PATCH',
                path: '/:id/status',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleChangeStatus),
            },
        ];
    }
}
