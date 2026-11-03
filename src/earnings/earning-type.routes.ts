import type { RequestHandler } from 'express';
import { inject, injectable } from 'tsyringe';
import type { RouteDef } from '@bhs-dev/typescript-common-types';

import {
    BaseRoute,
    RequireAuthenticationSymbol,
    RequireMemberOrPlatformAdminSymbol,
    RequirePlatformAdminSymbol,
    type RequireMemberOrPlatformAdmin,
    type RequirePlatformAdmin,
} from '../platform';
import { EarningTypeControllerSymbol } from './earnings.symbols';
import type { EarningTypeController } from './earning-type.controller';

@injectable()
export class EarningTypeRoutes extends BaseRoute {
    constructor(
        @inject(EarningTypeControllerSymbol) private readonly controller: EarningTypeController,
        @inject(RequireAuthenticationSymbol) private readonly requireAuthentication: RequestHandler,
        @inject(RequireMemberOrPlatformAdminSymbol)
        private readonly requireMemberOrPlatformAdmin: RequireMemberOrPlatformAdmin,
        @inject(RequirePlatformAdminSymbol)
        private readonly requirePlatformAdmin: RequirePlatformAdmin,
    ) {
        super();
    }

    routes(): RouteDef[] {
        // Catálogo global (spec 0021): escrita é do admin da plataforma; leitura, de qualquer
        // membro ou admin da plataforma.
        const write = [this.requireAuthentication, this.requirePlatformAdmin()];
        const read = [this.requireAuthentication, this.requireMemberOrPlatformAdmin()];

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
