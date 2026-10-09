import type { DomainEvent } from '../platform';

/** Publicado uma vez por fatura registrada no fechamento (spec 0013, INV-0013-07). */
export const STATEMENT_CLOSED = 'StatementClosed' as const;
export type StatementClosed = DomainEvent<
    typeof STATEMENT_CLOSED,
    {
        statementId: string;
        creditCardId: string;
        startsOn: string; // ISO date, `YYYY-MM-DD`
        closesOn: string;
        dueOn: string;
        totalCents: number;
        previousBalanceCents: number;
        amountDueCents: number;
    }
>;

/** Publicado na quitação da fatura: por pagamento ou pelo fechamento com devido `<= 0`. */
export const STATEMENT_PAID = 'StatementPaid' as const;
export type StatementPaid = DomainEvent<
    typeof STATEMENT_PAID,
    { statementId: string; creditCardId: string; paidOn: string }
>;

/** Publicado quando um estorno de cartão é lançado (spec 0013, Estornos). */
export const CREDIT_CARD_REFUND_REGISTERED = 'CreditCardRefundRegistered' as const;
export type CreditCardRefundRegistered = DomainEvent<
    typeof CREDIT_CARD_REFUND_REGISTERED,
    {
        refundId: string;
        creditCardId: string;
        expenseId: string | null;
        amountCents: number;
        occurredOn: string; // ISO date, `YYYY-MM-DD`
        postedOn: string;
    }
>;
