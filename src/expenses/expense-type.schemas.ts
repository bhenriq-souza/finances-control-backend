import { z } from 'zod';

const name = z.string().trim().min(1).max(120);

export const createExpenseTypeSchema = z.object({ name }).strict();

/** `strict()` recusa campo desconhecido (`archivedAt` só muda por arquivamento). */
export const updateExpenseTypeSchema = z.object({ name }).strict();

export const expenseTypeIdParamsSchema = z.object({ id: z.uuid() });
