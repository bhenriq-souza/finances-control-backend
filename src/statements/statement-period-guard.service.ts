import { inject, injectable } from 'tsyringe';
import type { EntityManager } from 'typeorm';

import { CreditCardServiceSymbol, type CreditCardService } from '../accounts';
import type { StatementPeriodGuard } from '../expenses';
import { businessToday } from '../platform';
import { CreditCardStatement } from './credit-card-statement.entity';
import { firstCycle, nextCycle } from './statement-chain';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC of a `YYYY-MM-DD` date, the form `cycleFor` works with. */
const utcDay = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const isoOf = (date: Date): string => date.toISOString().slice(0, 10);

/** Noon UTC keeps the day stable when the expenses interface re-reads it in business time. */
const noonOf = (date: Date): Date => new Date(date.getTime() + DAY_MS / 2);

/**
 * `StatementPeriodGuard` implementation (spec 0013, A janela fechada). Read-only: it derives
 * the last closed day by chaining cycles, whether or not `closeDue` has recorded them yet.
 */
@injectable()
export class StatementPeriodGuardService implements StatementPeriodGuard {
    constructor(@inject(CreditCardServiceSymbol) private readonly creditCards: CreditCardService) {}

    /**
     * The `closesOn` of the last chained cycle with `closesOn` before today; when none has
     * passed, the day before the first cycle. The chain continues from the last recorded
     * statement when there is one, so a `closing_day` change never reopens a closed window.
     */
    async closedThrough(manager: EntityManager, creditCardId: string): Promise<Date> {
        const card = await this.creditCards.findById(creditCardId);
        const today = businessToday();
        const last = await manager.getRepository(CreditCardStatement).findOne({
            where: { creditCardId },
            order: { closesOn: 'DESC' },
        });
        let cycle = last
            ? nextCycle(card, utcDay(last.closesOn))
            : firstCycle(card, utcDay(businessToday(card.createdAt)));
        let closed = last ? utcDay(last.closesOn) : new Date(cycle.startsOn.getTime() - DAY_MS);

        while (isoOf(cycle.closesOn) < today) {
            closed = cycle.closesOn;
            cycle = nextCycle(card, closed);
        }

        return noonOf(closed);
    }
}
