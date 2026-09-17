import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses } from '../platform';
import { listQuerySchema } from './archiving';
import { CreditCardServiceSymbol } from './accounts.symbols';
import { toCreditCardResponse } from './credit-card.response';
import {
    createCreditCardSchema,
    creditCardIdParamsSchema,
    updateCreditCardSchema,
} from './credit-card.schemas';
import type { CreditCardService } from './credit-card.service';

@injectable()
export class CreditCardController {
    constructor(@inject(CreditCardServiceSymbol) private readonly service: CreditCardService) {}

    async handleListCreditCards(req: Request, res: Response): Promise<Response> {
        const query = listQuerySchema.parse(req.query);

        const cards = await this.service.list(query);

        return HttpResponses.ok(
            res,
            cards.map((card) => toCreditCardResponse(card)),
        );
    }

    async handleGetCreditCard(req: Request, res: Response): Promise<Response> {
        const { id } = creditCardIdParamsSchema.parse(req.params);

        return HttpResponses.ok(res, toCreditCardResponse(await this.service.findById(id)));
    }

    async handleCreateCreditCard(req: Request, res: Response): Promise<Response> {
        const data = createCreditCardSchema.parse(req.body);

        return HttpResponses.created(res, toCreditCardResponse(await this.service.create(data)));
    }

    async handleUpdateCreditCard(req: Request, res: Response): Promise<Response> {
        const { id } = creditCardIdParamsSchema.parse(req.params);
        const changes = updateCreditCardSchema.parse(req.body);

        return HttpResponses.ok(res, toCreditCardResponse(await this.service.update(id, changes)));
    }

    async handleArchiveCreditCard(req: Request, res: Response): Promise<Response> {
        const { id } = creditCardIdParamsSchema.parse(req.params);

        return HttpResponses.ok(
            res,
            toCreditCardResponse(await this.service.setArchived(id, true)),
        );
    }

    async handleUnarchiveCreditCard(req: Request, res: Response): Promise<Response> {
        const { id } = creditCardIdParamsSchema.parse(req.params);

        return HttpResponses.ok(
            res,
            toCreditCardResponse(await this.service.setArchived(id, false)),
        );
    }
}
