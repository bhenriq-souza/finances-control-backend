import { z } from 'zod';

const name = z.string().trim().min(1).max(120);

export const createEarningTypeSchema = z.object({ name }).strict();

export const updateEarningTypeSchema = z.object({ name }).strict();

export const earningTypeIdParamsSchema = z.object({ id: z.uuid() });
