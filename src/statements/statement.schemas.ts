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
