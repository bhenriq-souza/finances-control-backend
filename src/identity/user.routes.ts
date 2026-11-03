import type { RequestHandler } from 'express';
import { inject, injectable } from 'tsyringe';
import type { RouteDef } from '@bhs-dev/typescript-common-types';

import {
    BaseRoute,
    RequireAuthenticationSymbol,
    RequirePlatformAdminSymbol,
    RequireProfileSymbol,
    type RequirePlatformAdmin,
    type RequireProfile,
} from '../platform';
import { parseAvatarBody } from './avatar-body.middleware';
import { UserControllerSymbol } from './identity.symbols';
import { USER_PROFILES } from './user-profile';
import type { UserController } from './user.controller';

@injectable()
export class UserRoutes extends BaseRoute {
    constructor(
        @inject(UserControllerSymbol) private readonly controller: UserController,
        @inject(RequireAuthenticationSymbol) private readonly requireAuthentication: RequestHandler,
        @inject(RequireProfileSymbol) private readonly requireProfile: RequireProfile,
        @inject(RequirePlatformAdminSymbol)
        private readonly requirePlatformAdmin: RequirePlatformAdmin,
    ) {
        super();
    }

    routes(): RouteDef[] {
        // Toda rota daqui exige autenticação (INV-0010-01). Gerir usuários é do
        // admin da plataforma (INV-0021-08); a foto pede um perfil qualquer.
        const admin = [this.requireAuthentication, this.requirePlatformAdmin()];
        // A foto exige um perfil qualquer: `/me` continua sendo a única rota de
        // quem está pendente (INV-0010-03).
        const anyProfile = [this.requireAuthentication, this.requireProfile(...USER_PROFILES)];

        return [
            {
                method: 'GET',
                path: '/me',
                middlewares: [this.requireAuthentication],
                handler: this.bind(this.controller, this.controller.handleGetMe),
            },
            {
                method: 'PUT',
                path: '/me/avatar',
                // O corpo só é lido depois de autenticação e perfil: quem não pode
                // gravar não chega a enviar meio megabyte ao processo.
                middlewares: [...anyProfile, parseAvatarBody],
                handler: this.bind(this.controller, this.controller.handlePutAvatar),
            },
            {
                method: 'GET',
                path: '/me/avatar',
                middlewares: anyProfile,
                handler: this.bind(this.controller, this.controller.handleGetAvatar),
            },
            {
                method: 'DELETE',
                path: '/me/avatar',
                middlewares: anyProfile,
                handler: this.bind(this.controller, this.controller.handleDeleteAvatar),
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
