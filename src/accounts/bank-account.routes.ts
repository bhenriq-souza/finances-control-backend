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
import { BankAccountControllerSymbol } from './accounts.symbols';
import type { BankAccountController } from './bank-account.controller';

@injectable()
export class BankAccountRoutes extends BaseRoute {
    constructor(
        @inject(BankAccountControllerSymbol) private readonly controller: BankAccountController,
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
                handler: this.bind(this.controller, this.controller.handleListBankAccounts),
            },
            {
                method: 'GET',
                path: '/:id',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleGetBankAccount),
            },
            {
                method: 'POST',
                path: '/',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleCreateBankAccount),
            },
            {
                method: 'PATCH',
                path: '/:id',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleUpdateBankAccount),
            },
        ];
    }
}
