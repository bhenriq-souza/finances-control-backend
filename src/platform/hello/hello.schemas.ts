import { z } from 'zod';

export const nameParamsSchema = z.object({
    name: z.string().regex(/^[\p{L}-]{1,40}$/u),
});
