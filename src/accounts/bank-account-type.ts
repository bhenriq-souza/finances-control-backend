/**
 * Tipos de conta bancária do produto (F002). Persistido como `text` sob CHECK,
 * seguindo o precedente da spec 0010.
 */
export const BANK_ACCOUNT_TYPES = ['CHECKING', 'SAVINGS', 'INVESTMENT'] as const;

export type BankAccountType = (typeof BANK_ACCOUNT_TYPES)[number];

export const isBankAccountType = (value: unknown): value is BankAccountType =>
    typeof value === 'string' && BANK_ACCOUNT_TYPES.includes(value as BankAccountType);
