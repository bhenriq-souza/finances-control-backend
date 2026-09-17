import type { RequestHandler } from 'express';
import { inject, injectable } from 'tsyringe';
import type { RouteDef } from '@bhs-dev/typescript-common-types';

import { BaseRoute } from '../platform';
import {
    RequireAuthenticationSymbol,
    RequireProfileSymbol,
    UserControllerSymbol,
} from './identity.symbols';
import type { UserController } from './user.controller';
import type { UserProfile } from './user-profile';

type RequireProfile = (...profiles: UserProfile[]) => RequestHandler;

@injectable()
export class UserRoutes extends BaseRoute {
    constructor(
        @inject(UserControllerSymbol) private readonly controller: UserController,
        @inject(RequireAuthenticationSymbol) private readonly requireAuthentication: RequestHandler,
        @inject(RequireProfileSymbol) private readonly requireProfile: RequireProfile,
    ) {
        super();
    }

    routes(): RouteDef[] {
        // Toda rota daqui exige autenticação (INV-0010-01). O perfil é exigido
        // em todas menos `/me`, que é como quem está sem perfil descobre isso.
        const admin = [this.requireAuthentication, this.requireProfile('ADMIN')];

        return [
            {
                method: 'GET',
                path: '/me',
                middlewares: [this.requireAuthentication],
                handler: this.bind(this.controller, this.controller.handleGetMe),
            },
            {
                method: 'GET',
                path: '/',
                middlewares: admin,
                handler: this.bind(this.controller, this.controller.handleListUsers),
            },
            {
                method: 'PATCH',
                path: '/:id/profile',
                middlewares: admin,
                handler: this.bind(this.controller, this.controller.handleGrantProfile),
            },
            {
                method: 'DELETE',
                path: '/:id/profile',
                middlewares: admin,
                handler: this.bind(this.controller, this.controller.handleRevokeProfile),
            },
        ];
    }
}
