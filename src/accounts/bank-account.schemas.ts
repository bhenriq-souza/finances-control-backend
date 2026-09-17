import { z } from 'zod';

import { BANK_ACCOUNT_TYPES } from './bank-account-type';

/**
 * Dinheiro entra como inteiro de centavos (INV-0011-01). Fração de centavo é
 * `400`, nunca arredondamento silencioso (ERR-0011-10).
 */
const cents = z.int();

/** O saldo pode ser negativo; o limite de cheque especial, não. */
const nonNegativeCents = z.int().min(0);

const description = z.string().trim().min(1).max(120);
const accountNumber = z.string().trim().min(1).max(40);

export const createBankAccountSchema = z
    .object({
        bankId: z.uuid(),
        type: z.enum(BANK_ACCOUNT_TYPES),
        accountNumber,
        description,
        openingBalanceCents: cents,
        overdraftLimitCents: nonNegativeCents.optional(),
    })
    .strict();

/**
 * `strict()` recusa campo desconhecido citando o nome (ERR-0011-11) — e é o que
 * barra `currentBalanceCents` e `openingBalanceCents`: o primeiro só muda por
 * lançamento (INV-0011-04), o segundo é imutável (INV-0011-05). `bankId` também
 * fica de fora: mudar a conta de banco é cadastrar outra conta.
 */
export const updateBankAccountSchema = z
    .object({
        type: z.enum(BANK_ACCOUNT_TYPES).optional(),
        accountNumber: accountNumber.optional(),
        description: description.optional(),
        overdraftLimitCents: nonNegativeCents.optional(),
    })
    .strict();

export const bankAccountIdParamsSchema = z.object({ id: z.uuid() });
