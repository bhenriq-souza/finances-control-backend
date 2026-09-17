import { z } from 'zod';

const name = z.string().trim().min(1).max(120);

/** Limite é sempre positivo; o CHECK do banco é a terceira rede. */
const creditLimitCents = z.int().positive();

/** Dia do mês, sem mês (F002). O dia inexistente é resolvido na derivação. */
const dayOfMonth = z.int().min(1).max(31);

export const createCreditCardSchema = z
    .object({
        bankId: z.uuid(),
        name,
        creditLimitCents,
        closingDay: dayOfMonth,
        dueDay: dayOfMonth,
    })
    .strict();

/**
 * `strict()` recusa campo desconhecido citando o nome (ERR-0011-11) — e é o que
 * barra `availableLimitCents`, que só muda por lançamento ou por alteração do
 * limite total (INV-0011-04). `bankId` também fica de fora: trocar o cartão de
 * banco é cadastrar outro cartão.
 */
export const updateCreditCardSchema = z
    .object({
        name: name.optional(),
        creditLimitCents: creditLimitCents.optional(),
        closingDay: dayOfMonth.optional(),
        dueDay: dayOfMonth.optional(),
    })
    .strict();

export const creditCardIdParamsSchema = z.object({ id: z.uuid() });
