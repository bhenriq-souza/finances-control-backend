import { z } from 'zod';

import { USER_PROFILES } from './user-profile';

/**
 * `:id` validado como uuid antes de chegar ao banco: sem isso, um id malformado
 * viraria erro de sintaxe do PostgreSQL — um 500 para o que é 400.
 */
export const userIdParamsSchema = z.object({
    id: z.uuid(),
});

export const grantProfileBodySchema = z.object({
    profile: z.enum(USER_PROFILES),
});
