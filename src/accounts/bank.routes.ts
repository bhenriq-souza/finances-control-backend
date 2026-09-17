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
import { BankControllerSymbol } from './accounts.symbols';
import type { BankController } from './bank.controller';

@injectable()
export class BankRoutes extends BaseRoute {
    constructor(
        @inject(BankControllerSymbol) private readonly controller: BankController,
        @inject(RequireAuthenticationSymbol) private readonly requireAuthentication: RequestHandler,
        @inject(RequireProfileSymbol) private readonly requireProfile: RequireProfile,
    ) {
        super();
    }

    routes(): RouteDef[] {
        // "Gerenciar contas" é atribuição do ADMIN; ler, de qualquer perfil —
        // o BILLER precisa escolher o banco ao lançar uma despesa (spec 0011).
        const write = [this.requireAuthentication, this.requireProfile('ADMIN')];
        const read = [this.requireAuthentication, this.requireProfile(...USER_PROFILES)];

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
        ];
    }
}
