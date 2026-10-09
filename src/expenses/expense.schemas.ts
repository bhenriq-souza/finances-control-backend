import { z } from 'zod';

import { EXPENSE_KINDS } from './expense-kind';
import { EXPENSE_STATUSES } from './expense-status';

/** Dinheiro entra como inteiro positivo de centavos; fração é `400` (ERR-0012-12). */
const amountCents = z.int().positive();

const businessDate = z.iso.date();

/** Só os status atribuíveis na criação (ERR-0012-14). */
const CREATION_STATUSES = ['OPEN', 'FORECAST', 'VERIFYING'] as const;

export const createExpenseSchema = z
    .object({
        description: z.string().trim().min(1).max(200),
        expenseTypeId: z.uuid(),
        kind: z.enum(EXPENSE_KINDS),
        amountCents,
        occurredOn: businessDate,
        bankAccountId: z.uuid().optional(),
        creditCardId: z.uuid().optional(),
        postedOn: businessDate.optional(),
        status: z.enum(CREATION_STATUSES).default('OPEN'),
        /** Obrigatório em `INSTALLMENT`, proibido nos demais (ERR-0012-07). */
        installmentTotal: z.int().min(2).max(120).optional(),
        notes: z.string().trim().min(1).max(1000).optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
        if (data.kind === 'INSTALLMENT' && data.installmentTotal === undefined) {
            ctx.addIssue({
                code: 'custom',
                path: ['installmentTotal'],
                message: 'installmentTotal is required for INSTALLMENT',
            });
        }

        if (data.kind !== 'INSTALLMENT' && data.installmentTotal !== undefined) {
            ctx.addIssue({
                code: 'custom',
                path: ['installmentTotal'],
                message: 'installmentTotal is only allowed for INSTALLMENT',
            });
        }

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

/**
 * Alvos aceitos por `PATCH /expenses/:id/status`. `FORECAST` e `OVERDUE` não são
 * alvo: o par é recusado com ERR-0012-08 pelo serviço, não por validação.
 */
export const changeExpenseStatusSchema = z
    .object({
        status: z.enum(EXPENSE_STATUSES),
        paidOn: businessDate.optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
        if (data.status !== 'PAID' && data.paidOn !== undefined) {
            ctx.addIssue({
                code: 'custom',
                path: ['paidOn'],
                message: 'paidOn is only allowed when status is PAID',
            });
        }
    });

export type ChangeExpenseStatus = z.infer<typeof changeExpenseStatusSchema>;

export const expenseIdParamsSchema = z.object({ id: z.uuid() });

/**
 * `PATCH /expenses/:id`. Estrito: `kind`, `status`, `paidOn`, `bankAccountId`,
 * `creditCardId` e `installment*` são recusados citando a chave (ERR-0012-11).
 */
export const updateExpenseSchema = z
    .object({
        description: z.string().trim().min(1).max(200).optional(),
        expenseTypeId: z.uuid().optional(),
        occurredOn: businessDate.optional(),
        amountCents: amountCents.optional(),
        postedOn: businessDate.optional(),
        notes: z.string().trim().min(1).max(1000).nullable().optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field must be provided',
    });

export type UpdateExpense = z.infer<typeof updateExpenseSchema>;

/** Filtros de `GET /expenses`, combinados por E (ERR-0012-15 para `from` > `to`). */
export const listExpensesQuerySchema = z
    .object({
        from: businessDate.optional(),
        to: businessDate.optional(),
        status: z.enum(EXPENSE_STATUSES).optional(),
        kind: z.enum(EXPENSE_KINDS).optional(),
        expenseTypeId: z.uuid().optional(),
        bankAccountId: z.uuid().optional(),
        creditCardId: z.uuid().optional(),
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

export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

/** `PATCH /expenses/:id/payment-method`: exatamente um dos dois ids; `postedOn` só no cartão. */
export const changePaymentMethodSchema = z
    .object({
        bankAccountId: z.uuid().optional(),
        creditCardId: z.uuid().optional(),
        postedOn: businessDate.optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
        if ((data.bankAccountId === undefined) === (data.creditCardId === undefined)) {
            const message = 'Exactly one of bankAccountId and creditCardId is required';

            ctx.addIssue({ code: 'custom', path: ['bankAccountId'], message });
            ctx.addIssue({ code: 'custom', path: ['creditCardId'], message });
        }

        if (data.postedOn !== undefined && data.creditCardId === undefined) {
            ctx.addIssue({
                code: 'custom',
                path: ['postedOn'],
                message: 'postedOn is only allowed for credit card expenses',
            });
        }
    });

export type ChangePaymentMethod = z.infer<typeof changePaymentMethodSchema>;
