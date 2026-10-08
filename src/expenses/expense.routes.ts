import type { RequestHandler } from 'express';
import { inject, injectable } from 'tsyringe';
import type { RouteDef } from '@bhs-dev/typescript-common-types';

import {
    BaseRoute,
    RequireAuthenticationSymbol,
    RequireProfileSymbol,
    type RequireProfile,
} from '../platform';
import type { ExpenseController } from './expense.controller';
import { ExpenseControllerSymbol } from './expenses.symbols';

@injectable()
export class ExpenseRoutes extends BaseRoute {
    constructor(
        @inject(ExpenseControllerSymbol) private readonly controller: ExpenseController,
        @inject(RequireAuthenticationSymbol) private readonly requireAuthentication: RequestHandler,
        @inject(RequireProfileSymbol) private readonly requireProfile: RequireProfile,
    ) {
        super();
    }

    routes(): RouteDef[] {
        const write = [this.requireAuthentication, this.requireProfile('ADMIN', 'BILLER')];

        return [
            {
                method: 'POST',
                path: '/',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleCreateExpense),
            },
            {
                method: 'PATCH',
                path: '/:id/status',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleChangeExpenseStatus),
            },
        ];
    }
}
