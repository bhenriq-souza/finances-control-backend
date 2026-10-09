import type { ExpenseRecurrence } from './expense-recurrence.entity';

export type RecurrenceResponse = {
    id: string;
    description: string;
    typeId: string;
    amountCents: number;
    dayOfMonth: number;
    bankAccountId: string | null;
    creditCardId: string | null;
    startsOn: string;
    endsOn: string | null;
    nextOccurrenceOn: string | null;
    createdAt: string;
    updatedAt: string;
};

/** A série com a próxima data de ocorrência (a primeira de hoje em diante), se houver. */
export type ExpenseRecurrenceView = ExpenseRecurrence & { nextOccurrenceOn: string | null };

export const toRecurrenceResponse = (series: ExpenseRecurrenceView): RecurrenceResponse => ({
    id: series.id,
    description: series.description,
    typeId: series.expenseTypeId,
    amountCents: series.amountCents,
    dayOfMonth: series.dayOfMonth,
    bankAccountId: series.bankAccountId,
    creditCardId: series.creditCardId,
    startsOn: series.startsOn,
    endsOn: series.endsOn,
    nextOccurrenceOn: series.nextOccurrenceOn,
    createdAt: series.createdAt.toISOString(),
    updatedAt: series.updatedAt.toISOString(),
});
