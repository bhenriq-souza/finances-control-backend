import type { BankAccount } from './bank-account.entity';
import type { BankAccountType } from './bank-account-type';
import { toBankResponse, type BankResponse } from './bank.response';

export type BankAccountResponse = {
    id: string;
    bank: BankResponse;
    type: BankAccountType;
    accountNumber: string;
    description: string;
    openingBalanceCents: number;
    currentBalanceCents: number;
    overdraftLimitCents: number;
    archivedAt: string | null;
    createdAt: string;
};

/** Exige a conta com o banco carregado: a resposta o publica aninhado. */
export const toBankAccountResponse = (
    account: BankAccount & { bank: NonNullable<BankAccount['bank']> },
): BankAccountResponse => ({
    id: account.id,
    bank: toBankResponse(account.bank),
    type: account.type,
    accountNumber: account.accountNumber,
    description: account.description,
    openingBalanceCents: account.openingBalanceCents,
    currentBalanceCents: account.currentBalanceCents,
    overdraftLimitCents: account.overdraftLimitCents,
    archivedAt: account.archivedAt?.toISOString() ?? null,
    createdAt: account.createdAt.toISOString(),
});
