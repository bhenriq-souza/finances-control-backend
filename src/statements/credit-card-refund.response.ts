import type { CreditCardRefund } from './credit-card-refund.entity';

export type CreditCardRefundResponse = {
    id: string;
    creditCardId: string;
    expenseId: string | null;
    description: string;
    amountCents: number;
    occurredOn: string;
    postedOn: string;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
};

export const toCreditCardRefundResponse = (refund: CreditCardRefund): CreditCardRefundResponse => ({
    id: refund.id,
    creditCardId: refund.creditCardId,
    expenseId: refund.expenseId,
    description: refund.description,
    amountCents: refund.amountCents,
    occurredOn: refund.occurredOn,
    postedOn: refund.postedOn,
    notes: refund.notes,
    createdAt: refund.createdAt.toISOString(),
    updatedAt: refund.updatedAt.toISOString(),
});
