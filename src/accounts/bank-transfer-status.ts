/** Uma transferência não é cobrança: só aconteceu ou vai acontecer (spec 0018). */
export const BANK_TRANSFER_STATUSES = ['SCHEDULED', 'COMPLETED'] as const;

export type BankTransferStatus = (typeof BANK_TRANSFER_STATUSES)[number];
