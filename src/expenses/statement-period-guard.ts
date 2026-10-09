import type { EntityManager } from 'typeorm';

/**
 * Port declared by `expenses` and implemented by `statements` (spec 0013, A janela
 * fechada): `expenses` cannot import `statements`, so the dependency is inverted.
 */
export interface StatementPeriodGuard {
    /** Last closed day of the card; a `postedOn` up to it, inclusive, is in a closed statement. */
    closedThrough(manager: EntityManager, creditCardId: string): Promise<Date>;
}

export const StatementPeriodGuardSymbol = Symbol.for('StatementPeriodGuard');

/** Guard that closes nothing: a minimal date, so the default `postedOn` is `occurredOn`. */
export class OpenPeriodGuard implements StatementPeriodGuard {
    closedThrough(): Promise<Date> {
        return Promise.resolve(new Date(0));
    }
}
