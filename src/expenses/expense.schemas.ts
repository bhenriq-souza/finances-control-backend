import { z } from 'zod';

/** Dinheiro entra como inteiro positivo de centavos; fração é `400` (ERR-0012-12). */
const amountCents = z.int().positive();

const businessDate = z.iso.date();

/** Só os status atribuíveis na criação (ERR-0012-14). */
const CREATION_STATUSES = ['OPEN', 'FORECAST', 'VERIFYING'] as const;

/** `INSTALLMENT` pertence à tarefa de parcelamento; aqui só as despesas de uma linha. */
const SINGLE_ROW_KINDS = ['FIXED', 'VARIABLE'] as const;

export const createExpenseSchema = z
    .object({
        description: z.string().trim().min(1).max(200),
        expenseTypeId: z.uuid(),
        kind: z.enum(SINGLE_ROW_KINDS),
        amountCents,
        occurredOn: businessDate,
        bankAccountId: z.uuid().optional(),
        creditCardId: z.uuid().optional(),
        postedOn: businessDate.optional(),
        status: z.enum(CREATION_STATUSES).default('OPEN'),
        /** Proibido fora de `INSTALLMENT` (ERR-0012-07). */
        installmentTotal: z
            .never({ error: 'installmentTotal is only allowed for INSTALLMENT' })
            .optional(),
        notes: z.string().trim().min(1).max(1000).optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
        if ((data.bankAccountId === undefined) === (data.creditCardId === undefined)) {
            const message = 'Exactly one of bankAccountId and creditCardId is required';

            ctx.addIssue({ code: 'custom', path: ['bankAccountId'], message });
            ctx.addIssue({ code: 'custom', path: ['creditCardId'], message });
        }

        if (data.postedOn !== undefined) {
            if (data.creditCardId === undefined) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['postedOn'],
                    message: 'postedOn is only allowed for credit card expenses',
                });
            } else if (data.postedOn < data.occurredOn) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['postedOn'],
                    message: 'postedOn must not be before occurredOn',
                });
            }
        }
    });

export type CreateExpense = z.infer<typeof createExpenseSchema>;
