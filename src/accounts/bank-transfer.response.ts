import type { BankTransfer } from './bank-transfer.entity';
import type { BankTransferStatus } from './bank-transfer-status';

export type BankTransferResponse = {
    id: string;
    fromBankAccountId: string;
    toBankAccountId: string;
    amountCents: number;
    occurredOn: string;
    status: BankTransferStatus;
    completedOn: string | null;
    description: string;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
};

export const toBankTransferResponse = (transfer: BankTransfer): BankTransferResponse => ({
    id: transfer.id,
    fromBankAccountId: transfer.fromBankAccountId,
    toBankAccountId: transfer.toBankAccountId,
    amountCents: transfer.amountCents,
    occurredOn: transfer.occurredOn,
    status: transfer.status,
    completedOn: transfer.completedOn,
    description: transfer.description,
    notes: transfer.notes,
    createdAt: transfer.createdAt.toISOString(),
    updatedAt: transfer.updatedAt.toISOString(),
});
