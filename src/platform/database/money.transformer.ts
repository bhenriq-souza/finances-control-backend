import type { ValueTransformer } from 'typeorm';

/** `numeric(14,2)` como o driver `pg` o entrega: opcionalmente negativo, até duas casas. */
const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Único ponto de conversão entre a coluna `numeric(14,2)` e o inteiro de centavos
 * que circula na aplicação e na API (INV-0000-04, INV-0003-05, ADR-0007).
 *
 * A conversão é feita por manipulação de dígitos, nunca por aritmética de ponto
 * flutuante: `cents / 100` introduziria erro já em valores triviais, e o erro só
 * apareceria depois de somado mil vezes num relatório.
 */
export const moneyTransformer: ValueTransformer = {
    /** Aplicação → banco. */
    to(value: unknown): string | null {
        if (value === null || value === undefined) return null;

        if (typeof value !== 'number' || !Number.isInteger(value)) {
            throw new TypeError(
                `monetary value must be an integer number of cents, received: ${String(value)}`,
            );
        }

        const sign = value < 0 ? '-' : '';
        // padStart(3) garante ao menos um dígito na parte inteira: 5 centavos → "005" → "0.05".
        const digits = Math.abs(value).toString().padStart(3, '0');

        return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
    },

    /** Banco → aplicação. */
    from(value: unknown): number | null {
        if (value === null || value === undefined) return null;

        const raw = typeof value === 'string' ? value.trim() : String(value);
        const match = DECIMAL_PATTERN.exec(raw);

        if (!match) {
            throw new TypeError(
                `monetary column must hold a decimal with at most two places, received: ${raw}`,
            );
        }

        const integerPart = match[2] ?? '0';
        const fraction = (match[3] ?? '').padEnd(2, '0');
        const cents = Number(`${integerPart}${fraction}`);

        if (!Number.isSafeInteger(cents)) {
            throw new TypeError(`monetary value exceeds the safe integer range: ${raw}`);
        }

        // Normaliza "-0.00" para 0: um zero negativo atravessaria comparações estritas.
        if (cents === 0) return 0;

        return match[1] ? -cents : cents;
    },
};
