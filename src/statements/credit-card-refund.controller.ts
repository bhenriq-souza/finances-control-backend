import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses } from '../platform';
import { toCreditCardRefundResponse } from './credit-card-refund.response';
import {
    createCreditCardRefundSchema,
    creditCardRefundIdParamsSchema,
    listCreditCardRefundsQuerySchema,
    updateCreditCardRefundSchema,
} from './credit-card-refund.schemas';
import type { CreditCardRefundService } from './credit-card-refund.service';
import { CreditCardRefundServiceSymbol } from './statements.symbols';

@injectable()
export class CreditCardRefundController {
    constructor(
        @inject(CreditCardRefundServiceSymbol) private readonly service: CreditCardRefundService,
    ) {}

    async handleCreateRefund(req: Request, res: Response): Promise<Response> {
        const data = createCreditCardRefundSchema.parse(req.body);

        return HttpResponses.created(
            res,
            toCreditCardRefundResponse(await this.service.create(data)),
        );
    }

    async handleListRefunds(req: Request, res: Response): Promise<Response> {
        const query = listCreditCardRefundsQuerySchema.parse(req.query);

        return HttpResponses.ok(
            res,
            (await this.service.list(query)).map(toCreditCardRefundResponse),
        );
    }

    async handleGetRefund(req: Request, res: Response): Promise<Response> {
        const { id } = creditCardRefundIdParamsSchema.parse(req.params);

        return HttpResponses.ok(res, toCreditCardRefundResponse(await this.service.findById(id)));
    }

    async handleUpdateRefund(req: Request, res: Response): Promise<Response> {
        const { id } = creditCardRefundIdParamsSchema.parse(req.params);
        const changes = updateCreditCardRefundSchema.parse(req.body);

        return HttpResponses.ok(
            res,
            toCreditCardRefundResponse(await this.service.update(id, changes)),
        );
    }

    async handleDeleteRefund(req: Request, res: Response): Promise<Response> {
        const { id } = creditCardRefundIdParamsSchema.parse(req.params);

        await this.service.delete(id);

        return HttpResponses.noContent(res);
    }
}
