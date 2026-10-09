import { z } from 'zod';

/** Janela máxima dos relatórios, em meses (spec 0015, ERR-0015-02). */
export const MAX_REPORT_MONTHS = 120;

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be in YYYY-MM format');

/** Número de meses da janela `[from, to]`, inclusivos; ambos em `YYYY-MM`. */
export const monthsBetween = (from: string, to: string): number =>
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) +
    1;

/** Lista os meses `YYYY-MM` de `from` a `to`, inclusivos. */
export const monthsInWindow = (from: string, to: string): string[] => {
    const count = monthsBetween(from, to);
    const start = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)) - 1;

    return Array.from({ length: count }, (_, i) => {
        const index = start + i;

        return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
    });
};

/**
 * Base dos parâmetros `from`/`to` dos relatórios (ERR-0015-01 e ERR-0015-02), para os quatro
 * relatórios reaproveitarem: formato `YYYY-MM`, `from` <= `to`, no máximo 120 meses.
 */
export const reportWindowShape = { from: month, to: month };

export const refineReportWindow = (
    data: { from: string; to: string },
    ctx: z.RefinementCtx,
): void => {
    if (data.from > data.to) {
        for (const field of ['from', 'to'] as const) {
            ctx.addIssue({ code: 'custom', path: [field], message: 'from must not be after to' });
        }

        return;
    }

    if (monthsBetween(data.from, data.to) > MAX_REPORT_MONTHS) {
        ctx.addIssue({
            code: 'custom',
            path: ['to'],
            message: `window must not exceed ${MAX_REPORT_MONTHS} months`,
        });
    }
};

/** `includeForecast` (ERR-0015-04): só `true` ou `false`; ausente vale `false`. */
export const includeForecastParam = z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true');
