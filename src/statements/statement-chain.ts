import { cycleFor, type BillingCycle, type BillingCycleConfig } from '../accounts';

/**
 * Encadeamento dos ciclos de fatura (spec 0013, _Encadeamento dos ciclos_).
 *
 * Funções puras sobre `cycleFor` (spec 0011): o ciclo seguinte a uma fatura
 * fechada continua de onde ela parou, então não há buraco nem sobreposição
 * mesmo depois de mudar `closing_day` (INV-0013-03).
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Meia-noite UTC do dia, como `cycleFor` normaliza. */
const dayOf = (date: Date): Date =>
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const addDays = (date: Date, days: number): Date => new Date(dayOf(date).getTime() + days * DAY_MS);

/** Primeiro ciclo do cartão: o da data de cadastro no fuso de negócio. */
export function firstCycle(card: BillingCycleConfig, createdOn: Date): BillingCycle {
    return cycleFor(card, createdOn);
}

/**
 * Ciclo seguinte a um que fechou em `previousClosesOn`: começa no dia seguinte,
 * e `closesOn`/`dueOn` são os de `cycleFor` com a configuração atual.
 */
export function nextCycle(card: BillingCycleConfig, previousClosesOn: Date): BillingCycle {
    const startsOn = addDays(previousClosesOn, 1);
    const { closesOn, dueOn } = cycleFor(card, startsOn);

    return { startsOn, closesOn, dueOn };
}

export type ChainAnchor = {
    /** `closesOn` da última fatura fechada, ou `null` se o cartão não tem nenhuma. */
    lastClosedClosesOn: Date | null;
    /** Data de cadastro do cartão, usada quando não há fatura fechada. */
    createdOn: Date;
};

/** Os próximos `count` ciclos da cadeia, a partir da última fatura fechada. */
export function chainCycles(
    card: BillingCycleConfig,
    anchor: ChainAnchor,
    count: number,
): BillingCycle[] {
    const cycles: BillingCycle[] = [];
    let closesOn = anchor.lastClosedClosesOn;

    for (let index = 0; index < count; index += 1) {
        const cycle: BillingCycle =
            closesOn === null ? firstCycle(card, anchor.createdOn) : nextCycle(card, closesOn);

        cycles.push(cycle);
        closesOn = cycle.closesOn;
    }

    return cycles;
}

/**
 * O ciclo da cadeia a que `postedOn` pertence (INV-0013-01). Uma data anterior ao
 * início da cadeia cai no primeiro ciclo gerado; esse caso é da janela fechada.
 */
export function cycleContaining(
    card: BillingCycleConfig,
    anchor: ChainAnchor,
    postedOn: Date,
): BillingCycle {
    const target = dayOf(postedOn).getTime();
    let cycle = chainCycles(card, anchor, 1)[0]!;

    while (cycle.closesOn.getTime() < target) {
        cycle = nextCycle(card, cycle.closesOn);
    }

    return cycle;
}
