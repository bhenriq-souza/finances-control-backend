import type { DomainEvent } from '../platform';

/**
 * Eventos publicados pelo módulo `accounts` (spec 0018). Só tipos e constantes.
 * Publicado ao criar concluída e ao concluir; desfazer não publica.
 */
export const TRANSFER_COMPLETED = 'TransferCompleted' as const;

export type TransferCompleted = DomainEvent<
    typeof TRANSFER_COMPLETED,
    {
        transferId: string;
        fromBankAccountId: string;
        toBankAccountId: string;
        amountCents: number;
        completedOn: string;
    }
>;
