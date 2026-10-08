import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses } from '../platform';
import { BankTransferServiceSymbol } from './accounts.symbols';
import { toBankTransferResponse } from './bank-transfer.response';
import {
    bankTransferIdParamsSchema,
    changeBankTransferStatusSchema,
    createBankTransferSchema,
    listBankTransfersQuerySchema,
    updateBankTransferSchema,
} from './bank-transfer.schemas';
import type { BankTransferService } from './bank-transfer.service';

@injectable()
export class BankTransferController {
    constructor(@inject(BankTransferServiceSymbol) private readonly service: BankTransferService) {}

    async handleListBankTransfers(req: Request, res: Response): Promise<Response> {
        const query = listBankTransfersQuerySchema.parse(req.query);

        return HttpResponses.ok(res, (await this.service.list(query)).map(toBankTransferResponse));
    }

    async handleGetBankTransfer(req: Request, res: Response): Promise<Response> {
        const { id } = bankTransferIdParamsSchema.parse(req.params);

        return HttpResponses.ok(res, toBankTransferResponse(await this.service.findById(id)));
    }

    async handleUpdateBankTransfer(req: Request, res: Response): Promise<Response> {
        const { id } = bankTransferIdParamsSchema.parse(req.params);
        const changes = updateBankTransferSchema.parse(req.body);

        return HttpResponses.ok(
            res,
            toBankTransferResponse(await this.service.update(id, changes)),
        );
    }

    async handleDeleteBankTransfer(req: Request, res: Response): Promise<Response> {
        const { id } = bankTransferIdParamsSchema.parse(req.params);

        await this.service.delete(id);

        return HttpResponses.noContent(res);
    }

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
