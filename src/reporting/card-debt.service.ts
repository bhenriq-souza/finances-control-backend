import { inject, injectable } from 'tsyringe';
import type { DataSource } from 'typeorm';

import { DatabaseConnectionSymbol, moneyTransformer } from '../platform';
import { StatementService, type StatementView } from '../statements';
import { COMPOSITION } from './composition';

/** Janela de cada chamada a `StatementService.list` para o futuro (o serviço limita a 120). */
const CHUNK_YEARS = 5;

/** Faturas de um cartão e o previsto de cada uma, o necessário para a dívida em qualquer `D`. */
export type CardLedger = {
    creditCardId: string;
    paymentBankAccountId: string | null;
    statements: StatementView[];
    /** `previstasCents` por `startsOn` da fatura projetada (despesas `FORECAST` da janela). */
    forecastByStart: Map<string, number>;
};

const addDays = (iso: string, days: number): string => {
    const date = new Date(`${iso}T00:00:00.000Z`);

    date.setUTCDate(date.getUTCDate() + days);

    return date.toISOString().slice(0, 10);
};

const addYears = (iso: string, years: number): string => {
    const date = new Date(`${iso}T00:00:00.000Z`);

    date.setUTCFullYear(date.getUTCFullYear() + years);

    return date.toISOString().slice(0, 10);
};

/** O que uma fatura projetada (`OPEN`) ainda deve: sem `previousBalanceCents` (INV-0015-06). */
const projectedDue = (ledger: CardLedger, statement: StatementView): number =>
    statement.totalCents -
    statement.paidCents +
    (ledger.forecastByStart.get(statement.startsOn) ?? 0);

/**
 * Dívida do cartão em `D` (`YYYY-MM-DD`), spec 0015: o restante das `CLOSED`, mais as projetadas
 * com `dueOn ≤ D`, mais o crédito (restante negativo) da última `PAID`. `ROLLED_OVER` fica de
 * fora: o restante dela já está na fatura seguinte.
 */
export function cardDebtOn(ledger: CardLedger, date: string): number {
    let debt = 0;
    let latest: StatementView | undefined;

    for (const statement of ledger.statements) {
        if (statement.status === 'OPEN') {
            if (statement.dueOn <= date) debt += projectedDue(ledger, statement);

            continue;
        }

        if (statement.status === 'CLOSED') debt += statement.remainingCents;
        if (latest === undefined || statement.closesOn > latest.closesOn) latest = statement;
    }

    // O crédito de uma `PAID` só é somado enquanto ela é a última fechada: a seguinte já o
    // carrega em `previousBalanceCents`, e somá-lo de novo contaria a mesma dívida duas vezes.
    return latest?.status === 'PAID' && latest.remainingCents < 0
        ? debt + latest.remainingCents
        : debt;
}

/** Dívida das faturas que vencem em `month` (`YYYY-MM`): `cardDueCents`. */
export function cardDueIn(ledger: CardLedger, month: string): number {
    let due = 0;

    for (const statement of ledger.statements) {
        if (statement.dueOn.slice(0, 7) !== month) continue;

        if (statement.status === 'CLOSED') due += statement.remainingCents;
        else if (statement.status === 'OPEN') due += projectedDue(ledger, statement);
    }

    return due;
}

/**
 * Dívida dos cartões (spec 0015, Dívida dos cartões). As faturas vêm de `StatementService.list`
 * (que já faz o fechamento de recuperação e o encadeamento dos ciclos da spec 0013); as despesas
 * `FORECAST`, que o total da fatura exclui, vêm de SQL próprio. Somente leitura (INV-0015-01).
 */
@injectable()
export class CardDebtService {
    constructor(
        @inject(DatabaseConnectionSymbol) private readonly dataSource: DataSource,
        @inject(StatementService) private readonly statements: StatementService,
    ) {}

    /**
     * Um `CardLedger` por cartão (arquivados inclusive), com faturas até `lastDay`.
     * `paidByBankAccountId` restringe aos cartões que a conta paga.
     */
    async ledgers(lastDay: string, paidByBankAccountId?: string): Promise<CardLedger[]> {
        const cards = (await this.dataSource.query(
            `SELECT c.id, c.payment_bank_account_id AS payer
             FROM credit_cards c
             WHERE ($1::uuid IS NULL OR c.payment_bank_account_id = $1::uuid)
             ORDER BY c.created_at, c.id`,
            [paidByBankAccountId ?? null],
        )) as Array<{ id: string; payer: string | null }>;

        const forecasts = await this.forecastPostings(cards.map((card) => card.id));
        const ledgers: CardLedger[] = [];

        for (const card of cards) {
            const statements = await this.statementsOf(card.id, lastDay);
            const postings = forecasts.get(card.id) ?? [];
            const forecastByStart = new Map<string, number>();

            for (const statement of statements) {
                if (statement.status !== 'OPEN') continue;

                forecastByStart.set(
                    statement.startsOn,
                    postings
                        .filter(
                            (posting) =>
                                posting.postedOn >= statement.startsOn &&
                                posting.postedOn <= statement.closesOn,
                        )
                        .reduce((sum, posting) => sum + posting.cents, 0),
                );
            }

            ledgers.push({
                creditCardId: card.id,
                paymentBankAccountId: card.payer,
                statements,
                forecastByStart,
            });
        }

        return ledgers;
    }

    /**
     * O que já foi fechado e a aberta de hoje (janela padrão do serviço), e as projetadas dali
     * até `lastDay`, em janelas que respeitam o limite de faturas por chamada.
     */
    private async statementsOf(creditCardId: string, lastDay: string): Promise<StatementView[]> {
        const statements = await this.statements.list({ creditCardId });
        const current = statements.at(-1);

        if (current?.status !== 'OPEN') return statements;

        let from = addDays(current.closesOn, 1);

        while (from <= lastDay) {
            const to =
                addYears(from, CHUNK_YEARS) < lastDay ? addYears(from, CHUNK_YEARS) : lastDay;

            statements.push(...(await this.statements.list({ creditCardId, from, to })));
            from = addDays(to, 1);
        }

        return statements;
    }

    private async forecastPostings(
        cardIds: string[],
    ): Promise<Map<string, Array<{ postedOn: string; cents: number }>>> {
        const rows = (await this.dataSource.query(
            `SELECT x.credit_card_id AS card_id, to_char(x.posted_on, 'YYYY-MM-DD') AS posted_on,
                    SUM(x.amount_cents)::text AS total
             FROM expenses x
             WHERE x.credit_card_id = ANY($1::uuid[]) AND x.status = ANY($2::text[])
             GROUP BY 1, 2`,
            [cardIds, [...COMPOSITION.expenses.forecast]],
        )) as Array<{ card_id: string; posted_on: string; total: string }>;
        const result = new Map<string, Array<{ postedOn: string; cents: number }>>();

        for (const row of rows) {
            const postings = result.get(row.card_id) ?? [];

            postings.push({
                postedOn: row.posted_on,
                cents: moneyTransformer.from(row.total) as number,
            });
            result.set(row.card_id, postings);
        }

        return result;
    }
}
