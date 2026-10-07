import type { DomainEvent } from '../platform';

/**
 * Eventos publicados pelo módulo `earnings` (spec 0014, "Eventos"). Só tipos e
 * constantes: o contrato é compartilhado, o módulo publicador é um só.
 */
export const EARNING_CREATED = 'EarningCreated' as const;
export type EarningCreated = DomainEvent<
    typeof EARNING_CREATED,
    {
        earningId: string;
        kind: 'FIXED' | 'VARIABLE' | 'INSTALLMENT';
        status: 'OPEN' | 'FORECAST' | 'VERIFYING';
        amountCents: number;
        occurredOn: string; // `YYYY-MM-DD`
        bankAccountId: string;
        installmentGroupId: string | null;
    }
>;
