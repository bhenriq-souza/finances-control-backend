import { z } from 'zod';

/** Janela máxima do extrato, em dias, inclusivos (spec 0015, ERR-0015-05). */
export const MAX_MOVEMENTS_DAYS = 366;

const DAY_MS = 86_400_000;

const isRealDate = (value: string): boolean => {
    const parsed = new Date(`${value}T00:00:00Z`);

    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const day = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be in YYYY-MM-DD format')
    .refine(isRealDate, 'must be a valid date');

/** Dia anterior a `date` (`YYYY-MM-DD`), em calendário civil. */
export const previousDay = (date: string): string =>
    new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);

/** `GET /reports/account-movements`. */
export const accountMovementsQuerySchema = z
    .object({ bankAccountId: z.uuid(), from: day, to: day })
    .strict()
    .superRefine((data, ctx) => {
        if (!isRealDate(data.from) || !isRealDate(data.to)) return;

        if (data.from > data.to) {
            for (const field of ['from', 'to'] as const) {
                ctx.addIssue({
                    code: 'custom',
                    path: [field],
                    message: 'from must not be after to',
                });
            }

            return;
        }

        const days =
            (Date.parse(`${data.to}T00:00:00Z`) - Date.parse(`${data.from}T00:00:00Z`)) / DAY_MS +
            1;

        if (days > MAX_MOVEMENTS_DAYS) {
            ctx.addIssue({
                code: 'custom',
                path: ['to'],
                message: `window must not exceed ${MAX_MOVEMENTS_DAYS} days`,
            });
        }
    });

export type AccountMovementsQuery = z.infer<typeof accountMovementsQuerySchema>;
