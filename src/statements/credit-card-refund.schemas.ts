import { z } from 'zod';

const businessDate = z.iso.date();

/** Dinheiro entra como inteiro positivo de centavos (ERR-0013-15). */
const amountCents = z.int().positive();

export const createCreditCardRefundSchema = z
    .object({
        creditCardId: z.uuid(),
        description: z.string().trim().min(1).max(200),
        amountCents,
        occurredOn: businessDate,
        postedOn: businessDate.optional(),
        expenseId: z.uuid().optional(),
        notes: z.string().trim().min(1).max(1000).optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
        if (data.postedOn !== undefined && data.postedOn < data.occurredOn) {
            ctx.addIssue({
                code: 'custom',
                path: ['postedOn'],
                message: 'postedOn must not be before occurredOn',
            });
        }
    });

export type CreateCreditCardRefund = z.infer<typeof createCreditCardRefundSchema>;

/** `PATCH`: só `description` e `notes`; qualquer outra chave é recusada (ERR-0013-16). */
export const updateCreditCardRefundSchema = z
    .object({
        description: z.string().trim().min(1).max(200).optional(),
        notes: z.string().trim().min(1).max(1000).nullable().optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field must be provided',
    });

export type UpdateCreditCardRefund = z.infer<typeof updateCreditCardRefundSchema>;

export const creditCardRefundIdParamsSchema = z.object({ id: z.uuid() });

/** Filtros de `GET /credit-card-refunds`; `from`/`to` sobre `postedOn`, inclusivos. */
export const listCreditCardRefundsQuerySchema = z
    .object({
        creditCardId: z.uuid().optional(),
        expenseId: z.uuid().optional(),
        from: businessDate.optional(),
        to: businessDate.optional(),
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

export type ListCreditCardRefundsQuery = z.infer<typeof listCreditCardRefundsQuerySchema>;
