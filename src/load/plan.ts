import type { BankAccountType } from '../accounts';

/**
 * What the initial load will create, already validated (spec 0019, _Abas e mapeamento_). References
 * between rows stay by name; the writer resolves them to ids as it creates each record, in the
 * order of _Ordem de gravação_. Every entry keeps the file and line it came from, for errors.
 */

export type Origin = { file: string; line: number };

export type PlannedBank = Origin & { name: string; febrabanCode: string };

export type PlannedAccount = Origin & {
    febrabanCode: string;
    description: string;
    type: BankAccountType;
    accountNumber: string;
    openingBalanceCents: number;
    overdraftLimitCents: number;
};

export type PlannedCard = Origin & {
    febrabanCode: string;
    name: string;
    creditLimitCents: number;
    closingDay: number;
    dueDay: number;
    /** `descricao` of the paying account. */
    paymentAccount: string;
};

export type CreationStatus = 'OPEN' | 'FORECAST';

/** An expense or earning target: exactly one of the two is set (ERR-0019-04). */
export type Target = { account?: string; card?: string };

export type PlannedExpense = Origin &
    Target & {
        description: string;
        expenseType: string;
        kind: 'FIXED' | 'VARIABLE' | 'INSTALLMENT';
        amountCents: number;
        occurredOn: string;
        status: CreationStatus;
        installmentTotal?: number;
        recurrenceEndsOn?: string;
        notes?: string;
    };

/**
 * A statement that closed outside the system: a card entry dated on the load day, paid early on
 * `dueOn` from the card's paying account (spec 0019, _Faturas em aberto_).
 */
export type PlannedOpenStatement = Origin & {
    description: string;
    card: string;
    expenseType: string;
    amountCents: number;
    dueOn: string;
    /** `descricao` of the card's paying account, from which the early payment is made. */
    paymentAccount: string;
};

export type PlannedEarning = Origin & {
    description: string;
    earningType: string;
    kind: 'FIXED' | 'VARIABLE' | 'INSTALLMENT';
    amountCents: number;
    occurredOn: string;
    account: string;
    status: CreationStatus;
    installmentTotal?: number;
    recurrenceEndsOn?: string;
    notes?: string;
};

export type LoadPlan = {
    banks: PlannedBank[];
    accounts: PlannedAccount[];
    cards: PlannedCard[];
    /** Names of the expense types marked `sim`; every other active type gets archived. */
    expenseTypes: (Origin & { name: string })[];
    expenses: PlannedExpense[];
    openStatements: PlannedOpenStatement[];
    earnings: PlannedEarning[];
};
