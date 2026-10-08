import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses, listQuerySchema } from '../platform';
import { ExpenseTypeServiceSymbol } from './expenses.symbols';
import { toExpenseTypeResponse } from './expense-type.response';
import {
    createExpenseTypeSchema,
    expenseTypeIdParamsSchema,
    updateExpenseTypeSchema,
} from './expense-type.schemas';
import type { ExpenseTypeService } from './expense-type.service';

@injectable()
export class ExpenseTypeController {
    constructor(@inject(ExpenseTypeServiceSymbol) private readonly service: ExpenseTypeService) {}

    async handleListExpenseTypes(req: Request, res: Response): Promise<Response> {
        const query = listQuerySchema.parse(req.query);

        return HttpResponses.ok(res, (await this.service.list(query)).map(toExpenseTypeResponse));
    }

    async handleCreateExpenseType(req: Request, res: Response): Promise<Response> {
        const data = createExpenseTypeSchema.parse(req.body);

        return HttpResponses.created(res, toExpenseTypeResponse(await this.service.create(data)));
    }

    async handleUpdateExpenseType(req: Request, res: Response): Promise<Response> {
        const { id } = expenseTypeIdParamsSchema.parse(req.params);
        const changes = updateExpenseTypeSchema.parse(req.body);

        return HttpResponses.ok(res, toExpenseTypeResponse(await this.service.update(id, changes)));
    }

    async handleArchiveExpenseType(req: Request, res: Response): Promise<Response> {
        const { id } = expenseTypeIdParamsSchema.parse(req.params);

        return HttpResponses.ok(
            res,
            toExpenseTypeResponse(await this.service.setArchived(id, true)),
        );
    }

    async handleUnarchiveExpenseType(req: Request, res: Response): Promise<Response> {
        const { id } = expenseTypeIdParamsSchema.parse(req.params);

        return HttpResponses.ok(
            res,
            toExpenseTypeResponse(await this.service.setArchived(id, false)),
        );
    }
}
