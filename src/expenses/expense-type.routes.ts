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
import type { ExpenseTypeController } from './expense-type.controller';
import { ExpenseTypeControllerSymbol } from './expenses.symbols';

@injectable()
export class ExpenseTypeRoutes extends BaseRoute {
    constructor(
        @inject(ExpenseTypeControllerSymbol) private readonly controller: ExpenseTypeController,
        @inject(RequireAuthenticationSymbol) private readonly requireAuthentication: RequestHandler,
        @inject(RequirePlatformAdminSymbol)
        private readonly requirePlatformAdmin: RequirePlatformAdmin,
        @inject(RequireMemberOrPlatformAdminSymbol)
        private readonly requireMemberOrPlatformAdmin: RequireMemberOrPlatformAdmin,
    ) {
        super();
    }

    routes(): RouteDef[] {
        const write = [this.requireAuthentication, this.requirePlatformAdmin()];
        const read = [this.requireAuthentication, this.requireMemberOrPlatformAdmin()];

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
