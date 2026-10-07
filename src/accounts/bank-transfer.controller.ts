import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses } from '../platform';
import { BankTransferServiceSymbol } from './accounts.symbols';
import { toBankTransferResponse } from './bank-transfer.response';
import {
    bankTransferIdParamsSchema,
    changeBankTransferStatusSchema,
    createBankTransferSchema,
} from './bank-transfer.schemas';
import type { BankTransferService } from './bank-transfer.service';

@injectable()
export class BankTransferController {
    constructor(@inject(BankTransferServiceSymbol) private readonly service: BankTransferService) {}

    async handleCreateBankTransfer(req: Request, res: Response): Promise<Response> {
        const data = createBankTransferSchema.parse(req.body);

        return HttpResponses.created(res, toBankTransferResponse(await this.service.create(data)));
    }

    async handleChangeBankTransferStatus(req: Request, res: Response): Promise<Response> {
        const { id } = bankTransferIdParamsSchema.parse(req.params);
        const change = changeBankTransferStatusSchema.parse(req.body);

        return HttpResponses.ok(
            res,
            toBankTransferResponse(await this.service.changeStatus(id, change)),
        );
    }
}
