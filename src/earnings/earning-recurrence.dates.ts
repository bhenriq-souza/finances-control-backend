import { addMonths } from '../platform';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Meses inteiros de `from` a `to`, pelo ano e mês (`YYYY-MM-DD`), sem olhar o dia. */
const monthsBetween = (from: string, to: string): number =>
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));

/**
 * Horizonte da série (spec 0017): o último dia do 12º mês depois do mês de `today`.
 * Hoje em março, o horizonte é 31 de março do ano seguinte.
 */
export const recurrenceHorizon = (today: string): string =>
    new Date(
        new Date(`${addMonths(`${today.slice(0, 7)}-01`, 13)}T00:00:00.000Z`).getTime() - DAY_MS,
    )
        .toISOString()
        .slice(0, 10);

/**
 * Datas das ocorrências de `startsOn` até `min(horizon, endsOn)`, inclusive: a do mês `k`
 * nasce de `startsOn + k` meses, então o dia 31 volta ao 31 nos meses que o têm.
 */
export const seriesDates = (startsOn: string, endsOn: string | null, horizon: string): string[] => {
    const limit = endsOn !== null && endsOn < horizon ? endsOn : horizon;
    const count = Math.max(monthsBetween(startsOn, limit) + 1, 1);
    const dates: string[] = [];

    for (let index = 0; index < count; index += 1) {
        const date = addMonths(startsOn, index);

        if (index > 0 && date > limit) break;
        dates.push(date);
    }

    return dates;
};
