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

        const read = [this.requireAuthentication, this.requireProfile(...USER_PROFILES)];

        return [
            {
                method: 'GET',
                path: '/',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleListExpenses),
            },
            {
                method: 'GET',
                path: '/:id',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleGetExpense),
            },
            {
                method: 'PATCH',
                path: '/:id',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleUpdateExpense),
            },
            {
                method: 'DELETE',
                path: '/:id',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleDeleteExpense),
            },
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
            {
                method: 'PATCH',
                path: '/:id/payment-method',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleChangePaymentMethod),
            },
        ];
    }
}
