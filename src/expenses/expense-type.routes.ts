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
import type { ExpenseTypeController } from './expense-type.controller';
import { ExpenseTypeControllerSymbol } from './expenses.symbols';

@injectable()
export class ExpenseTypeRoutes extends BaseRoute {
    constructor(
        @inject(ExpenseTypeControllerSymbol) private readonly controller: ExpenseTypeController,
        @inject(RequireAuthenticationSymbol) private readonly requireAuthentication: RequestHandler,
        @inject(RequireProfileSymbol) private readonly requireProfile: RequireProfile,
    ) {
        super();
    }

    routes(): RouteDef[] {
        const write = [this.requireAuthentication, this.requireProfile('ADMIN', 'BILLER')];
        const read = [this.requireAuthentication, this.requireProfile(...USER_PROFILES)];

        return [
            {
                method: 'GET',
                path: '/',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleListExpenseTypes),
            },
            {
                method: 'POST',
                path: '/',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleCreateExpenseType),
            },
            {
                method: 'PATCH',
                path: '/:id',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleUpdateExpenseType),
            },
            {
                method: 'POST',
                path: '/:id/archive',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleArchiveExpenseType),
            },
            {
                method: 'DELETE',
                path: '/:id/archive',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleUnarchiveExpenseType),
            },
        ];
    }
}
