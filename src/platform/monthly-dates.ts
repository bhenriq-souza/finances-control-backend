const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (value: number, size: number): string => String(value).padStart(size, '0');

/** Último dia do mês `month` (1 a 12), contando o 29 de fevereiro dos anos bissextos. */
const daysInMonth = (year: number, month: number): number =>
    new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Soma `months` meses a uma data de negócio `YYYY-MM-DD` (sem fuso, só calendário). O dia
 * inexistente no mês de destino vira o último dia dele; o dia original nunca se perde,
 * porque cada data nasce da original, não da anterior: `addMonths('2026-01-31', 1)` é
 * `2026-02-28` e `addMonths('2026-01-31', 2)` é `2026-03-31`.
 */
export const addMonths = (date: string, months: number): string => {
    const match = DATE_PATTERN.exec(date);

    if (!match) throw new TypeError(`date must be YYYY-MM-DD, received: ${date}`);
    if (!Number.isInteger(months)) {
        throw new TypeError(`months must be an integer, received: ${String(months)}`);
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
        throw new TypeError(`date is not a valid calendar date: ${date}`);
    }

    const index = year * 12 + (month - 1) + months;
    const targetYear = Math.floor(index / 12);
    const targetMonth = (index % 12) + 1;
    const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));

    return `${pad(targetYear, 4)}-${pad(targetMonth, 2)}-${pad(targetDay, 2)}`;
};

/**
 * Datas esperadas das `count` parcelas mensais: a parcela `k` cai em `firstDate + (k - 1)`
 * meses (specs 0012 e 0014, "Parcelamento").
 */
export const monthlyInstallmentDates = (firstDate: string, count: number): string[] =>
    Array.from({ length: count }, (_, index) => addMonths(firstDate, index));
