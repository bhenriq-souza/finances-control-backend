import type { EarningRecurrence } from './earning-recurrence.entity';

export type RecurrenceResponse = {
    id: string;
    description: string;
    typeId: string;
    amountCents: number;
    dayOfMonth: number;
    bankAccountId: string;
    startsOn: string;
    endsOn: string | null;
    nextOccurrenceOn: string | null;
    createdAt: string;
    updatedAt: string;
};

/** A série com a próxima data de ocorrência (a primeira de hoje em diante), se houver. */
export type EarningRecurrenceView = EarningRecurrence & { nextOccurrenceOn: string | null };

export const toRecurrenceResponse = (series: EarningRecurrenceView): RecurrenceResponse => ({
    id: series.id,
    description: series.description,
    typeId: series.earningTypeId,
    amountCents: series.amountCents,
    dayOfMonth: series.dayOfMonth,
    bankAccountId: series.bankAccountId,
    startsOn: series.startsOn,
    endsOn: series.endsOn,
    nextOccurrenceOn: series.nextOccurrenceOn,
    createdAt: series.createdAt.toISOString(),
    updatedAt: series.updatedAt.toISOString(),
});
