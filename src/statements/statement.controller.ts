import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses } from '../platform';
import {
    createEarlyPaymentSchema,
    createStatementPaymentSchema,
    currentStatementQuerySchema,
    earlyPaymentParamsSchema,
    earlyPaymentQuerySchema,
    listStatementsQuerySchema,
    statementIdParamsSchema,
    statementPaymentParamsSchema,
    updateStatementSchema,
} from './statement.schemas';
import { StatementPaymentService } from './statement-payment.service';
import { StatementService } from './statement.service';

@injectable()
export class StatementController {
    constructor(
        @inject(StatementService) private readonly service: StatementService,
        @inject(StatementPaymentService) private readonly payments: StatementPaymentService,
    ) {}

    async handleListStatements(req: Request, res: Response): Promise<Response> {
        const query = listStatementsQuerySchema.parse(req.query);

        return HttpResponses.ok(res, await this.service.list(query));
    }

    async handleGetCurrentStatement(req: Request, res: Response): Promise<Response> {
        const { creditCardId } = currentStatementQuerySchema.parse(req.query);

        return HttpResponses.ok(res, await this.service.current(creditCardId));
    }

    async handleGetStatement(req: Request, res: Response): Promise<Response> {
        const { id } = statementIdParamsSchema.parse(req.params);

        return HttpResponses.ok(res, await this.service.findById(id));
    }

    async handleUpdateStatement(req: Request, res: Response): Promise<Response> {
        const { id } = statementIdParamsSchema.parse(req.params);
        const changes = updateStatementSchema.parse(req.body);

        return HttpResponses.ok(res, await this.payments.update(id, changes));
    }

    async handlePayStatement(req: Request, res: Response): Promise<Response> {
        const { id } = statementIdParamsSchema.parse(req.params);
        const data = createStatementPaymentSchema.parse(req.body);

        return HttpResponses.created(res, await this.payments.pay(id, data));
    }

    async handlePayEarly(req: Request, res: Response): Promise<Response> {
        const data = createEarlyPaymentSchema.parse(req.body);

        return HttpResponses.created(res, await this.payments.payEarly(data));
    }

    async handleUndoStatementPayment(req: Request, res: Response): Promise<Response> {
        const { id, paymentId } = statementPaymentParamsSchema.parse(req.params);

        await this.payments.undo(id, paymentId);

        return HttpResponses.noContent(res);
    }

    async handleUndoEarlyPayment(req: Request, res: Response): Promise<Response> {
        const { paymentId } = earlyPaymentParamsSchema.parse(req.params);
        const { creditCardId } = earlyPaymentQuerySchema.parse(req.query);

        await this.payments.undoEarly(creditCardId, paymentId);

        return HttpResponses.noContent(res);
    }
}
