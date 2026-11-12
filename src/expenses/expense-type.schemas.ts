import { z } from 'zod';

import { listQuerySchema } from '../platform';

const name = z.string().trim().min(1).max(120);

export const createExpenseTypeSchema = z.object({ name }).strict();

/** `strict()` recusa campo desconhecido (`archivedAt` só muda por arquivamento). */
export const updateExpenseTypeSchema = z.object({ name }).strict();

export const expenseTypeIdParamsSchema = z.object({ id: z.uuid() });

/** `name` vazio (após `trim`) equivale a não informar; repetido na query é inválido. */
export const listExpenseTypesQuerySchema = listQuerySchema.extend({
    name: z.string().trim().max(120).optional(),
});
