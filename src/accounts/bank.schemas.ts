import { z } from 'zod';

/** Código do banco no padrão FEBRABAN: três dígitos, com zeros à esquerda. */
const febrabanCode = z.string().regex(/^[0-9]{3}$/, 'febrabanCode must be exactly three digits');

const name = z.string().trim().min(1).max(120);

export const createBankSchema = z
    .object({
        febrabanCode,
        name,
    })
    .strict();

/**
 * `strict()` recusa campo desconhecido citando o nome (ERR-0011-11). O código
 * FEBRABAN não é alterável: trocá-lo faz do registro outro banco, e as contas e
 * cartões ligados a ele continuariam apontando para o antigo.
 */
export const updateBankSchema = z
    .object({
        name,
    })
    .strict();

export const bankIdParamsSchema = z.object({ id: z.uuid() });
