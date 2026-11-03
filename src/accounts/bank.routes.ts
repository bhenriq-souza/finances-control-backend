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
import { BankControllerSymbol } from './accounts.symbols';
import type { BankController } from './bank.controller';

@injectable()
export class BankRoutes extends BaseRoute {
    constructor(
        @inject(BankControllerSymbol) private readonly controller: BankController,
        @inject(RequireAuthenticationSymbol) private readonly requireAuthentication: RequestHandler,
        @inject(RequirePlatformAdminSymbol)
        private readonly requirePlatformAdmin: RequirePlatformAdmin,
        @inject(RequireMemberOrPlatformAdminSymbol)
        private readonly requireMemberOrPlatformAdmin: RequireMemberOrPlatformAdmin,
    ) {
        super();
    }

    routes(): RouteDef[] {
        // Bancos são catálogo global (spec 0021): qualquer membro lê, só o admin da
        // plataforma escreve.
        const write = [this.requireAuthentication, this.requirePlatformAdmin()];
        const read = [this.requireAuthentication, this.requireMemberOrPlatformAdmin()];

        return [
            {
                method: 'GET',
                path: '/',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleListBanks),
            },
            {
                method: 'POST',
                path: '/',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleCreateBank),
            },
            {
                method: 'PATCH',
                path: '/:id',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleUpdateBank),
            },
            {
                method: 'POST',
                path: '/:id/archive',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleArchiveBank),
            },
            {
                method: 'DELETE',
                path: '/:id/archive',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleUnarchiveBank),
            },
        ];
    }
}
