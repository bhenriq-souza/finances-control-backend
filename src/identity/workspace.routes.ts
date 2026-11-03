import type { RequestHandler } from 'express';
import { inject, injectable } from 'tsyringe';
import type { RouteDef } from '@bhs-dev/typescript-common-types';

import {
    BaseRoute,
    RequireAuthenticationSymbol,
    RequirePlatformAdminSymbol,
    type RequirePlatformAdmin,
} from '../platform';
import { WorkspaceControllerSymbol } from './identity.symbols';
import type { WorkspaceController } from './workspace.controller';

@injectable()
export class WorkspaceRoutes extends BaseRoute {
    constructor(
        @inject(WorkspaceControllerSymbol) private readonly controller: WorkspaceController,
        @inject(RequireAuthenticationSymbol) private readonly requireAuthentication: RequestHandler,
        @inject(RequirePlatformAdminSymbol)
        private readonly requirePlatformAdmin: RequirePlatformAdmin,
    ) {
        super();
    }

    routes(): RouteDef[] {
        // Só o admin da plataforma gere espaços (INV-0021-08, ERR-0021-04).
        const platformAdmin = [this.requireAuthentication, this.requirePlatformAdmin()];

        return [
            {
                method: 'GET',
                path: '/',
                middlewares: platformAdmin,
                handler: this.bind(this.controller, this.controller.handleList),
            },
            {
                method: 'PATCH',
                path: '/:id',
                middlewares: platformAdmin,
                handler: this.bind(this.controller, this.controller.handleRename),
            },
        ];
    }
}
