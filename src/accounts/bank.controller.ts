import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses } from '../platform';
import { BankServiceSymbol } from './accounts.symbols';
import { toBankResponse } from './bank.response';
import { bankIdParamsSchema, createBankSchema, updateBankSchema } from './bank.schemas';
import type { BankService } from './bank.service';

@injectable()
export class BankController {
    constructor(@inject(BankServiceSymbol) private readonly service: BankService) {}

    async handleListBanks(_req: Request, res: Response): Promise<Response> {
        const banks = await this.service.list();

        return HttpResponses.ok(res, banks.map(toBankResponse));
    }

    async handleCreateBank(req: Request, res: Response): Promise<Response> {
        const data = createBankSchema.parse(req.body);
        const bank = await this.service.create(data);

        return HttpResponses.created(res, toBankResponse(bank));
    }

    async handleUpdateBank(req: Request, res: Response): Promise<Response> {
        const { id } = bankIdParamsSchema.parse(req.params);
        const changes = updateBankSchema.parse(req.body);

        const bank = await this.service.update(id, changes);

        return HttpResponses.ok(res, toBankResponse(bank));
    }
}
