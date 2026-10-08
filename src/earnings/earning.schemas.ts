import { z } from 'zod';

import { EARNING_KINDS } from './earning-kind';
import { EARNING_STATUSES } from './earning-status';

/** Status que uma receita pode ter ao nascer (ERR-0014-09). */
export const CREATION_STATUSES = ['OPEN', 'FORECAST', 'VERIFYING'] as const;

/**
 * `amountCents` é inteiro positivo: fração de centavo, zero e negativo são `400`,
 * nunca arredondados (ERR-0014-12).
 */
const amountCents = z.int().positive();

export const createEarningSchema = z
    .object({
        description: z.string().trim().min(1).max(200),
        earningTypeId: z.uuid(),
        // INSTALLMENT entra com a T-0014-06, que amplia o enum e gera as parcelas.
        kind: z.enum(['FIXED', 'VARIABLE']),
        amountCents,
        occurredOn: z.iso.date(),
        bankAccountId: z.uuid(),
        status: z.enum(CREATION_STATUSES).optional(),
        installmentTotal: z.int().min(2).max(120).optional(),
        notes: z.string().trim().min(1).max(1000).optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
        if (data.installmentTotal !== undefined) {
            ctx.addIssue({
                code: 'custom',
                path: ['installmentTotal'],
                message: 'installmentTotal is not allowed for this kind',
            });
        }
    });

export type CreateEarningInput = z.infer<typeof createEarningSchema>;

/**
 * `PATCH /earnings/:id/status`. Qualquer status é aceito aqui; o par fora da tabela de
 * transições (inclusive `FORECAST` e `OVERDUE` como alvo) vira `409` no serviço (ERR-0014-08).
 */
export const changeEarningStatusSchema = z
    .object({
        status: z.enum(EARNING_STATUSES),
        receivedOn: z.iso.date().optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
        if (data.receivedOn !== undefined && data.status !== 'RECEIVED') {
            ctx.addIssue({
                code: 'custom',
                path: ['receivedOn'],
                message: 'receivedOn is only allowed when status is RECEIVED',
            });
        }
    });

export type ChangeEarningStatusInput = z.infer<typeof changeEarningStatusSchema>;

export const earningIdParamsSchema = z.object({ id: z.uuid() });

/**
 * `PATCH /earnings/:id`. Estrito: `kind`, `status`, `receivedOn` e `installment*` são
 * recusados citando a chave (ERR-0014-11); corpo vazio também é `400`.
 */
export const updateEarningSchema = z
    .object({
        description: z.string().trim().min(1).max(200).optional(),
        earningTypeId: z.uuid().optional(),
        occurredOn: z.iso.date().optional(),
        amountCents: amountCents.optional(),
        bankAccountId: z.uuid().optional(),
        notes: z.string().trim().min(1).max(1000).nullable().optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field must be provided',
    });

export type UpdateEarningInput = z.infer<typeof updateEarningSchema>;

/** `GET /earnings`: filtros combinados por E; `from` > `to` é `400` (ERR-0014-13). */
export const listEarningsQuerySchema = z
    .object({
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
        status: z.enum(EARNING_STATUSES).optional(),
        kind: z.enum(EARNING_KINDS).optional(),
        earningTypeId: z.uuid().optional(),
        bankAccountId: z.uuid().optional(),
        installmentGroupId: z.uuid().optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
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

export type ListEarningsQuery = z.infer<typeof listEarningsQuerySchema>;
