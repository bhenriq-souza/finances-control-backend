import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses } from '../platform';
import { toExpenseResponse } from './expense.response';
import { createExpenseSchema } from './expense.schemas';
import type { ExpenseService } from './expense.service';
import { ExpenseServiceSymbol } from './expenses.symbols';

@injectable()
export class ExpenseController {
    constructor(@inject(ExpenseServiceSymbol) private readonly service: ExpenseService) {}

    async handleCreateExpense(req: Request, res: Response): Promise<Response> {
        const data = createExpenseSchema.parse(req.body);

        return HttpResponses.created(res, (await this.service.create(data)).map(toExpenseResponse));
    }
}
