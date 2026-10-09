import { z } from 'zod';

const businessDate = z.iso.date();

/** `GET /statements`: `creditCardId` é obrigatório (ERR-0013-02); `from` > `to` é 400 (ERR-0013-09). */
export const listStatementsQuerySchema = z
    .object({
        creditCardId: z.uuid(),
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

export type ListStatementsQuery = z.infer<typeof listStatementsQuerySchema>;

/** `GET /statements/current`. */
export const currentStatementQuerySchema = z.object({ creditCardId: z.uuid() }).strict();

export const statementIdParamsSchema = z.object({ id: z.uuid() });

/** Dinheiro entra como inteiro positivo de centavos (ERR-0013-15). */
const paymentAmountCents = z.int().positive();

/** `POST /statements/:id/payments`; `bankAccountId` é obrigatório nesta tarefa. */
export const createStatementPaymentSchema = z
    .object({
        bankAccountId: z.uuid(),
        amountCents: paymentAmountCents,
        paidOn: businessDate.optional(),
    })
    .strict();

export type CreateStatementPayment = z.infer<typeof createStatementPaymentSchema>;

/** `POST /statements/current/payments`: o pagamento antecipado nomeia o cartão. */
export const createEarlyPaymentSchema = z
    .object({
        creditCardId: z.uuid(),
        bankAccountId: z.uuid(),
        amountCents: paymentAmountCents,
        paidOn: businessDate.optional(),
    })
    .strict();

export type CreateEarlyPayment = z.infer<typeof createEarlyPaymentSchema>;

export const statementPaymentParamsSchema = z.object({ id: z.uuid(), paymentId: z.uuid() });

export const earlyPaymentParamsSchema = z.object({ paymentId: z.uuid() });

/** `DELETE /statements/current/payments/:paymentId?creditCardId=…`. */
export const earlyPaymentQuerySchema = z.object({ creditCardId: z.uuid() }).strict();

/** `PATCH /statements/:id`: só o mínimo informado; `null` o apaga (ERR-0013-15). */
export const updateStatementSchema = z
    .object({ minimumPaymentCents: z.int().nonnegative().nullable() })
    .strict();

export type UpdateStatement = z.infer<typeof updateStatementSchema>;
