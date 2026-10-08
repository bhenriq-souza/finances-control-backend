import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses } from '../platform';
import { toExpenseResponse } from './expense.response';
import {
    changeExpenseStatusSchema,
    createExpenseSchema,
    expenseIdParamsSchema,
    listExpensesQuerySchema,
    updateExpenseSchema,
} from './expense.schemas';
import type { ExpenseService } from './expense.service';
import { ExpenseServiceSymbol } from './expenses.symbols';

@injectable()
export class ExpenseController {
    constructor(@inject(ExpenseServiceSymbol) private readonly service: ExpenseService) {}

    async handleCreateExpense(req: Request, res: Response): Promise<Response> {
        const data = createExpenseSchema.parse(req.body);

        return HttpResponses.created(res, (await this.service.create(data)).map(toExpenseResponse));
    }

    async handleChangeExpenseStatus(req: Request, res: Response): Promise<Response> {
        const { id } = expenseIdParamsSchema.parse(req.params);
        const change = changeExpenseStatusSchema.parse(req.body);

        return HttpResponses.ok(
            res,
            toExpenseResponse(await this.service.changeStatus(id, change)),
        );
    }

    async handleListExpenses(req: Request, res: Response): Promise<Response> {
        const query = listExpensesQuerySchema.parse(req.query);

        return HttpResponses.ok(res, (await this.service.list(query)).map(toExpenseResponse));
    }

    async handleGetExpense(req: Request, res: Response): Promise<Response> {
        const { id } = expenseIdParamsSchema.parse(req.params);

        return HttpResponses.ok(res, toExpenseResponse(await this.service.findById(id)));
    }

    async handleUpdateExpense(req: Request, res: Response): Promise<Response> {
        const { id } = expenseIdParamsSchema.parse(req.params);
        const changes = updateExpenseSchema.parse(req.body);

        return HttpResponses.ok(res, toExpenseResponse(await this.service.update(id, changes)));
    }

    async handleDeleteExpense(req: Request, res: Response): Promise<Response> {
        const { id } = expenseIdParamsSchema.parse(req.params);

        await this.service.delete(id);

        return HttpResponses.noContent(res);
    }
}
