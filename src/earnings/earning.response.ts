import type { Earning } from './earning.entity';
import type { EarningKind } from './earning-kind';
import type { EarningStatus } from './earning-status';
import { toEarningTypeResponse, type EarningTypeResponse } from './earning-type.response';

export type EarningResponse = {
    id: string;
    description: string;
    kind: EarningKind;
    status: EarningStatus;
    amountCents: number;
    occurredOn: string;
    receivedOn: string | null;
    notes: string | null;
    recurrenceId: string | null;
    earningType: EarningTypeResponse;
    bankAccountId: string;
    installment: { groupId: string; number: number; total: number } | null;
    createdAt: string;
    updatedAt: string;
};

/** Exige o tipo carregado: a resposta o publica aninhado. */
export const toEarningResponse = (
    earning: Earning & { earningType: NonNullable<Earning['earningType']> },
): EarningResponse => ({
    id: earning.id,
    description: earning.description,
    kind: earning.kind,
    status: earning.status,
    amountCents: earning.amountCents,
    occurredOn: earning.occurredOn,
    receivedOn: earning.receivedOn,
    notes: earning.notes,
    recurrenceId: earning.recurrenceId,
    earningType: toEarningTypeResponse(earning.earningType),
    bankAccountId: earning.bankAccountId,
    installment:
        earning.installmentGroupId === null ||
        earning.installmentNumber === null ||
        earning.installmentTotal === null
            ? null
            : {
                  groupId: earning.installmentGroupId,
                  number: earning.installmentNumber,
                  total: earning.installmentTotal,
              },
    createdAt: earning.createdAt.toISOString(),
    updatedAt: earning.updatedAt.toISOString(),
});
