/**
 * Tipos de ocorrência de uma receita (spec 0014). Persistido como `text` sob
 * CHECK, seguindo o precedente da spec 0010.
 */
export const EARNING_KINDS = ['FIXED', 'VARIABLE', 'INSTALLMENT'] as const;

export type EarningKind = (typeof EARNING_KINDS)[number];
