/** Fuso de negócio do produto: "hoje" nunca é a data em UTC (spec 0012). */
export const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

/**
 * Data corrente no fuso de negócio, como `YYYY-MM-DD` (o formato da coluna
 * `date`). Helper único: todo default de data de negócio passa por aqui
 * (INV-0012-16). `now` existe para os testes.
 */
export const businessToday = (now: Date = new Date()): string => {
    const parts = Object.fromEntries(
        formatter.formatToParts(now).map((part) => [part.type, part.value]),
    );

    return `${parts.year}-${parts.month}-${parts.day}`;
};
