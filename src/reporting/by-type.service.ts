import { inject, injectable } from 'tsyringe';
import type { DataSource } from 'typeorm';

import { DatabaseConnectionSymbol, moneyTransformer } from '../platform';
import { COMPOSITION } from './composition';
import { monthsInWindow } from './report-window.schemas';

export type ByTypeEntry = { typeId: string; name: string; totalCents: number };

export type ByTypeMonth = {
    month: string;
    totalCents: number;
    refundsCents?: number;
    byType: ByTypeEntry[];
};

export type ByTypeReport = {
    from: string;
    to: string;
    includeForecast: boolean;
    months: ByTypeMonth[];
};

type Params = { from: string; to: string; includeForecast: boolean };

type Row = { month: string; type_id: string; name: string; total: string };

type Source = {
    table: string;
    typeTable: string;
    typeColumn: string;
    statuses: readonly string[];
    forecast: readonly string[];
    withRefunds: boolean;
};

/**
 * Relatórios de despesas e receitas por mês e tipo (spec 0015, AC-0015-07 e AC-0015-08).
 *
 * Base: o conjunto comprometido da regra de composição (INV-0015-02), mais `FORECAST` com
 * `includeForecast`. O mês é o de `occurred_on`. Somas em `numeric` no banco, convertidas em
 * inteiro de centavos na fronteira (INV-0015-04); o total do mês é a soma das partes
 * (INV-0015-07). Somente leitura, por SQL próprio (INV-0015-01).
 */
@injectable()
export class ByTypeReportService {
    constructor(@inject(DatabaseConnectionSymbol) private readonly dataSource: DataSource) {}

    expensesByType(params: Params): Promise<ByTypeReport> {
        return this.build(params, {
            table: 'expenses',
            typeTable: 'expense_types',
            typeColumn: 'expense_type_id',
            statuses: COMPOSITION.expenses.committed,
            forecast: COMPOSITION.expenses.forecast,
            withRefunds: true,
        });
    }

    earningsByType(params: Params): Promise<ByTypeReport> {
        return this.build(params, {
            table: 'earnings',
            typeTable: 'earning_types',
            typeColumn: 'earning_type_id',
            statuses: COMPOSITION.earnings.committed,
            forecast: COMPOSITION.earnings.forecast,
            withRefunds: false,
        });
    }

    private async build(
        { from, to, includeForecast }: Params,
        source: Source,
    ): Promise<ByTypeReport> {
        const statuses = includeForecast
            ? [...source.statuses, ...source.forecast]
            : [...source.statuses];
        const start = `${from}-01`;
        const end = `${to}-01`;

        // Os nomes de tabela e coluna vêm de literais deste arquivo, nunca da requisição.
        const rows = (await this.dataSource.query(
            `SELECT to_char(x.occurred_on, 'YYYY-MM') AS month, t.id AS type_id, t.name AS name,
                    SUM(x.amount_cents)::text AS total
             FROM ${source.table} x
             JOIN ${source.typeTable} t ON t.id = x.${source.typeColumn}
             WHERE x.status = ANY($1::text[])
               AND x.occurred_on >= $2::date
               AND x.occurred_on < ($3::date + interval '1 month')
             GROUP BY 1, t.id, t.name`,
            [statuses, start, end],
        )) as Row[];

        const refunds = source.withRefunds ? await this.refundsByMonth(start, end) : new Map();

        const byMonth = new Map<string, ByTypeEntry[]>();

        for (const row of rows) {
            const entries = byMonth.get(row.month) ?? [];

            entries.push({
                typeId: row.type_id,
                name: row.name,
                totalCents: moneyTransformer.from(row.total) as number,
            });
            byMonth.set(row.month, entries);
        }

        const months = monthsInWindow(from, to).map((month): ByTypeMonth => {
            const byType = (byMonth.get(month) ?? []).sort(
                (a, b) =>
                    b.totalCents - a.totalCents || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
            );
            const totalCents = byType.reduce((sum, entry) => sum + entry.totalCents, 0);

            return source.withRefunds
                ? { month, totalCents, refundsCents: refunds.get(month) ?? 0, byType }
                : { month, totalCents, byType };
        });

        return { from, to, includeForecast, months };
    }

    /** Estornos por mês do `occurred_on` do estorno; não abatem o tipo (spec 0015). */
    private async refundsByMonth(start: string, end: string): Promise<Map<string, number>> {
        const rows = (await this.dataSource.query(
            `SELECT to_char(r.occurred_on, 'YYYY-MM') AS month, SUM(r.amount_cents)::text AS total
             FROM credit_card_refunds r
             WHERE r.occurred_on >= $1::date
               AND r.occurred_on < ($2::date + interval '1 month')
             GROUP BY 1`,
            [start, end],
        )) as Array<{ month: string; total: string }>;

        return new Map(rows.map((row) => [row.month, moneyTransformer.from(row.total) as number]));
    }
}
