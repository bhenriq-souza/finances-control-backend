/**
 * Value parsing for the initial load (spec 0019). Every parser takes the raw cell text and returns
 * `undefined` when the text does not have the expected form; the caller turns that into
 * ERR-0019-02 with the file, line and column.
 */

/** Reais with a dot decimal and up to two places; comma thousands separators are accepted. */
const MONEY = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/**
 * Text in reais to integer cents, computed on the digits and never through floating point
 * (INV-0000-04, INV-0019-04). `1,593.00` → `159300`, `0.62` → `62`. Negative values and the
 * Brazilian form `1.000,00` are rejected.
 */
export function parseMoneyCents(text: string): number | undefined {
    const match = MONEY.exec(text.trim());
    if (!match) {
        return undefined;
    }

    const reais = match[1]!.replaceAll(',', '');
    const fraction = (match[2] ?? '').padEnd(2, '0');
    const cents = Number(reais) * 100 + Number(fraction);

    return Number.isSafeInteger(cents) ? cents : undefined;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `AAAA-MM-DD` that names a real calendar day; returned unchanged. */
export function parseIsoDate(text: string): string | undefined {
    const value = text.trim();
    const match = ISO_DATE.exec(value);
    if (!match) {
        return undefined;
    }

    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));

    return date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
        ? value
        : undefined;
}

/** A non-negative whole number written with digits only. */
export function parseInteger(text: string): number | undefined {
    const value = text.trim();

    return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
}

/** `sim` → `true`, `não` (or `nao`) → `false`, case-insensitive; anything else is invalid. */
export function parseYesNo(text: string): boolean | undefined {
    const value = text.trim().toLocaleLowerCase('pt-BR');
    if (value === 'sim') {
        return true;
    }

    return value === 'não' || value === 'nao' ? false : undefined;
}

/** Key used to compare names across tabs: trimmed and without case differences. */
export const nameKey = (text: string): string => text.trim().toLocaleLowerCase('pt-BR');
