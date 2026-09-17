import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses } from '../platform';
import { BankAccountServiceSymbol } from './accounts.symbols';
import { toBankAccountResponse } from './bank-account.response';
import {
    bankAccountIdParamsSchema,
    createBankAccountSchema,
    updateBankAccountSchema,
} from './bank-account.schemas';
import type { BankAccountService } from './bank-account.service';

@injectable()
export class BankAccountController {
    constructor(@inject(BankAccountServiceSymbol) private readonly service: BankAccountService) {}

    async handleListBankAccounts(_req: Request, res: Response): Promise<Response> {
        const accounts = await this.service.list();

        return HttpResponses.ok(res, accounts.map(toBankAccountResponse));
    }

    async handleGetBankAccount(req: Request, res: Response): Promise<Response> {
        const { id } = bankAccountIdParamsSchema.parse(req.params);

        return HttpResponses.ok(res, toBankAccountResponse(await this.service.findById(id)));
    }

    async handleCreateBankAccount(req: Request, res: Response): Promise<Response> {
        const data = createBankAccountSchema.parse(req.body);

        return HttpResponses.created(res, toBankAccountResponse(await this.service.create(data)));
    }

    async handleUpdateBankAccount(req: Request, res: Response): Promise<Response> {
        const { id } = bankAccountIdParamsSchema.parse(req.params);
        const changes = updateBankAccountSchema.parse(req.body);

        return HttpResponses.ok(res, toBankAccountResponse(await this.service.update(id, changes)));
    }
}
