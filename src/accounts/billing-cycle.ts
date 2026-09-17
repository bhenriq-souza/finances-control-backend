/**
 * Ciclo de fatura de um cartão (spec 0011).
 *
 * Fechamento e vencimento são **dias do mês, sem mês** (F002). Função pura: não
 * conhece banco nem HTTP, e é onde mora quase toda a regra da spec.
 */
export type BillingCycleConfig = {
    closingDay: number;
    dueDay: number;
};

export type BillingCycle = {
    /** Dia seguinte ao fechamento anterior. */
    startsOn: Date;
    /** Inclusivo: uma compra no dia do fechamento pertence a este ciclo. */
    closesOn: Date;
    dueOn: Date;
};

const MIN_DAY = 1;
const MAX_DAY = 31;

const utcDate = (year: number, month: number, day: number): Date =>
    new Date(Date.UTC(year, month, day));

/** Dia 0 do mês seguinte é o último dia deste mês. */
const lastDayOfMonth = (year: number, month: number): number =>
    new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/**
 * Resolve um dia que pode não existir no mês: 31 em fevereiro vira o último dia.
 * Sem isso, um cartão que fecha no dia 31 ficaria quatro meses por ano sem fatura.
 */
const resolveDay = (year: number, month: number, day: number): Date =>
    utcDate(year, month, Math.min(day, lastDayOfMonth(year, month)));

const addDays = (date: Date, days: number): Date =>
    utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days);

/** Meia-noite UTC do dia da referência: o ciclo é calendário, não instante. */
const dayOf = (date: Date): Date =>
    utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

function assertValidDay(day: number, field: string): void {
    if (!Number.isInteger(day) || day < MIN_DAY || day > MAX_DAY) {
        throw new TypeError(`${field} must be an integer between 1 and 31, received: ${day}`);
    }
}

/** O ciclo ao qual `reference` pertence. */
export function cycleFor(card: BillingCycleConfig, reference: Date): BillingCycle {
    assertValidDay(card.closingDay, 'closingDay');
    assertValidDay(card.dueDay, 'dueDay');

    const day = dayOf(reference);
    const closing = resolveDay(day.getUTCFullYear(), day.getUTCMonth(), card.closingDay);

    // Passado o fechamento deste mês, a referência já pertence ao ciclo seguinte.
    const closesOn =
        closing.getTime() < day.getTime()
            ? resolveDay(day.getUTCFullYear(), day.getUTCMonth() + 1, card.closingDay)
            : closing;

    const previousClosing = resolveDay(
        closesOn.getUTCFullYear(),
        closesOn.getUTCMonth() - 1,
        card.closingDay,
    );

    // Vencimento no mesmo dia do fechamento, ou antes, só pode ser no mês
    // seguinte — que é como todo cartão funciona. A comparação usa os dias
    // configurados, não os resolvidos: é a intenção do cartão que decide.
    const dueMonthOffset = card.dueDay > card.closingDay ? 0 : 1;

    const due = resolveDay(
        closesOn.getUTCFullYear(),
        closesOn.getUTCMonth() + dueMonthOffset,
        card.dueDay,
    );

    return {
        startsOn: addDays(previousClosing, 1),
        closesOn,
        // A resolução de dia inexistente pode empatar as duas datas: fechar dia
        // 30 e vencer dia 31 dá o mesmo 28 de fevereiro, uma fatura com zero dia
        // para pagar. Vencimento é sempre depois do fechamento.
        dueOn:
            due.getTime() > closesOn.getTime()
                ? due
                : resolveDay(
                      closesOn.getUTCFullYear(),
                      closesOn.getUTCMonth() + dueMonthOffset + 1,
                      card.dueDay,
                  ),
    };
}
