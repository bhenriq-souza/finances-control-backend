import { z } from 'zod';

import { BANK_TRANSFER_STATUSES } from './bank-transfer-status';

const date = z.iso.date();

const COMPLETED_ON_ONLY_WHEN_COMPLETED = 'completedOn is only allowed when status is COMPLETED';

export const createBankTransferSchema = z
    .object({
        fromBankAccountId: z.uuid(),
        toBankAccountId: z.uuid(),
        // Inteiro de centavos e positivo: fração ou zero é 400 (ERR-0018-05).
        amountCents: z.int().positive(),
        occurredOn: date,
        status: z.enum(BANK_TRANSFER_STATUSES).optional(),
        completedOn: date.optional(),
        description: z.string().trim().min(1).max(120),
        notes: z.string().trim().min(1).max(1000).optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
        // ERR-0018-01: cita os dois campos.
        if (data.fromBankAccountId === data.toBankAccountId) {
            for (const field of ['fromBankAccountId', 'toBankAccountId'] as const) {
                ctx.addIssue({
                    code: 'custom',
                    path: [field],
                    message: 'fromBankAccountId and toBankAccountId must be different accounts',
                });
            }
        }

        // ERR-0018-05: `completedOn` só existe em transferência concluída.
        if (data.status === 'SCHEDULED' && data.completedOn !== undefined) {
            ctx.addIssue({
                code: 'custom',
                path: ['completedOn'],
                message: COMPLETED_ON_ONLY_WHEN_COMPLETED,
            });
        }
    });

export const changeBankTransferStatusSchema = z
    .object({
        status: z.enum(BANK_TRANSFER_STATUSES),
        completedOn: date.optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
        if (data.status === 'SCHEDULED' && data.completedOn !== undefined) {
            ctx.addIssue({
                code: 'custom',
                path: ['completedOn'],
                message: COMPLETED_ON_ONLY_WHEN_COMPLETED,
            });
        }
    });

export const bankTransferIdParamsSchema = z.object({ id: z.uuid() });

export const updateBankTransferSchema = z
    .object({
        description: z.string().trim().min(1).max(120).optional(),
        notes: z.string().trim().min(1).max(1000).nullable().optional(),
        fromBankAccountId: z.uuid().optional(),
        toBankAccountId: z.uuid().optional(),
        amountCents: z.int().positive().optional(),
        occurredOn: date.optional(),
    })
    // ERR-0018-08: `status` e `completedOn` vão por `…/status`; a chave recusada é citada.
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field must be provided',
    });

export const listBankTransfersQuerySchema = z
    .object({
        bankAccountId: z.uuid().optional(),
        status: z.enum(BANK_TRANSFER_STATUSES).optional(),
        from: date.optional(),
        to: date.optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
        // ERR-0018-09
        if (data.from !== undefined && data.to !== undefined && data.from > data.to) {
            for (const field of ['from', 'to'] as const) {
                ctx.addIssue({
                    code: 'custom',
                    path: [field],
                    message: 'from must not be after to',
                });
            }
        }
    });

export type UpdateBankTransfer = z.infer<typeof updateBankTransferSchema>;
export type ListBankTransfersQuery = z.infer<typeof listBankTransfersQuerySchema>;
