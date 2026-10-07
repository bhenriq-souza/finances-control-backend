import { z } from 'zod';

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
