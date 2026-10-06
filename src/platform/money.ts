/**
 * Rateia `totalCents` em `parts` partes inteiras, em centavos (ADR-0007, regra 3).
 * O resto da divisão (0 a `parts - 1`) é absorvido pela primeira parte, e a soma
 * das partes é sempre igual ao total. Nunca usa ponto flutuante.
 *
 * `splitCents(10000, 3)` → `[3334, 3333, 3333]`.
 */
export const splitCents = (totalCents: number, parts: number): number[] => {
    if (!Number.isInteger(parts) || parts < 1) {
        throw new TypeError(`parts must be an integer >= 1, received: ${String(parts)}`);
    }

    if (!Number.isInteger(totalCents)) {
        throw new TypeError(`totalCents must be an integer, received: ${String(totalCents)}`);
    }

    const base = Math.trunc(totalCents / parts);
    const remainder = totalCents - base * parts;

    return Array.from({ length: parts }, (_, index) => (index === 0 ? base + remainder : base));
};
