import type { Bank } from './bank.entity';

export type BankResponse = {
    id: string;
    febrabanCode: string;
    name: string;
    archivedAt: string | null;
    createdAt: string;
};

export const toBankResponse = (bank: Bank): BankResponse => ({
    id: bank.id,
    febrabanCode: bank.febrabanCode,
    name: bank.name,
    archivedAt: bank.archivedAt?.toISOString() ?? null,
    createdAt: bank.createdAt.toISOString(),
});
