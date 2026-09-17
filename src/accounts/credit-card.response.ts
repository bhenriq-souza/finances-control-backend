import { cycleFor } from './billing-cycle';
import type { CreditCard } from './credit-card.entity';
import { toBankResponse, type BankResponse } from './bank.response';

export type BillingCycleResponse = {
    startsOn: string;
    closesOn: string;
    dueOn: string;
};

export type CreditCardResponse = {
    id: string;
    bank: BankResponse;
    name: string;
    creditLimitCents: number;
    availableLimitCents: number;
    closingDay: number;
    dueDay: number;
    currentCycle: BillingCycleResponse;
    archivedAt: string | null;
    createdAt: string;
};

/** Data de calendário: o ciclo não tem hora. */
const asDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * `currentCycle` é derivado na resposta, nunca persistido — é o que torna
 * verdadeiro que um cartão cadastrado **já nasce operante** (INV-0011-06), sem
 * passo extra que alguém possa esquecer de executar.
 */
export const toCreditCardResponse = (
    card: CreditCard & { bank: NonNullable<CreditCard['bank']> },
    reference: Date = new Date(),
): CreditCardResponse => {
    const cycle = cycleFor(card, reference);

    return {
        id: card.id,
        bank: toBankResponse(card.bank),
        name: card.name,
        creditLimitCents: card.creditLimitCents,
        availableLimitCents: card.availableLimitCents,
        closingDay: card.closingDay,
        dueDay: card.dueDay,
        currentCycle: {
            startsOn: asDate(cycle.startsOn),
            closesOn: asDate(cycle.closesOn),
            dueOn: asDate(cycle.dueOn),
        },
        archivedAt: card.archivedAt?.toISOString() ?? null,
        createdAt: card.createdAt.toISOString(),
    };
};
