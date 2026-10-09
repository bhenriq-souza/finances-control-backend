import { CustomError } from '@bhs-dev/typescript-common-errors';
import { inject, injectable } from 'tsyringe';
import type { DataSource } from 'typeorm';

import { DatabaseConnectionSymbol, moneyTransformer } from '../platform';
import { COMPOSITION } from './composition';

/** Transferência ainda não concluída: entra no previsto (emenda da spec 0018 à 0015). */
const TRANSFER_SCHEDULED = 'SCHEDULED';

export type ForecastAccount = { id: string; currentBalanceCents: number };

/** O que ainda vai se mover numa conta, no mês (`YYYY-MM`) do ponto em que entra. */
export type MonthlyPending = {
    earningsCents: number;
    expensesCents: number;
    transfersCents: number;
};

type Row = { id: string; month: string; total: string };

/**
 * Pendências de conta para o saldo previsto (spec 0015, Saldo previsto): receitas e despesas
 * de conta pendentes (regra de composição, INV-0015-02) e transferências `SCHEDULED`, cada
 * uma no mês do seu `occurred_on`. As de data passada caem no mês corrente, o primeiro ponto
 * futuro. Despesa de cartão fica de fora: é paga pela fatura (AC-0015-03).
 *
 * Somente leitura, por SQL próprio (INV-0015-01); somas em `numeric` (INV-0015-04).
 */
@injectable()
export class ForecastBalanceService {
    constructor(@inject(DatabaseConnectionSymbol) private readonly dataSource: DataSource) {}

    /** Contas (arquivadas inclusive) com o saldo corrente; `bankAccountId` restringe a uma. */
    async accounts(bankAccountId?: string): Promise<ForecastAccount[]> {
        const rows = (await this.dataSource.query(
            `SELECT a.id, a.current_balance_cents::text AS balance
             FROM bank_accounts a
             WHERE ($1::uuid IS NULL OR a.id = $1::uuid)
             ORDER BY a.created_at, a.id`,
            [bankAccountId ?? null],
        )) as Array<{ id: string; balance: string }>;

        if (bankAccountId !== undefined && rows.length === 0) {
            throw CustomError.notFound('Bank account not found', 'BANK_ACCOUNT_NOT_FOUND', {
                exposeMessage: true,
            });
        }

        return rows.map((row) => ({
            id: row.id,
            currentBalanceCents: moneyTransformer.from(row.balance) as number,
        }));
    }

    /**
     * Pendências por conta e mês, de `currentMonth` a `lastMonth` (`YYYY-MM`, inclusivos). O que
     * tem data anterior ao mês corrente entra no corrente.
     */
    async pendingByMonth(
        currentMonth: string,
        lastMonth: string,
        bankAccountId?: string,
    ): Promise<Map<string, Map<string, MonthlyPending>>> {
        const firstDay = `${currentMonth}-01`;
        const lastDay = `${lastMonth}-01`;
        const filter = bankAccountId ?? null;
        const result = new Map<string, Map<string, MonthlyPending>>();

        const add = (rows: Row[], field: keyof MonthlyPending): void => {
            for (const row of rows) {
                const months = result.get(row.id) ?? new Map<string, MonthlyPending>();
                const pending = months.get(row.month) ?? {
                    earningsCents: 0,
                    expensesCents: 0,
                    transfersCents: 0,
                };

                pending[field] += moneyTransformer.from(row.total) as number;
                months.set(row.month, pending);
                result.set(row.id, months);
            }
        };

        const bucket = (column: string): string =>
            `to_char(GREATEST(${column}, $2::date), 'YYYY-MM')`;
        const upTo = (column: string): string => `${column} < ($3::date + interval '1 month')`;

        add(
            (await this.dataSource.query(
                `SELECT e.bank_account_id AS id, ${bucket('e.occurred_on')} AS month,
                        SUM(e.amount_cents)::text AS total
                 FROM earnings e
                 WHERE e.status = ANY($1::text[]) AND ${upTo('e.occurred_on')}
                   AND ($4::uuid IS NULL OR e.bank_account_id = $4::uuid)
                 GROUP BY 1, 2`,
                [[...COMPOSITION.earnings.pending], firstDay, lastDay, filter],
            )) as Row[],
            'earningsCents',
        );

        add(
            (await this.dataSource.query(
                `SELECT x.bank_account_id AS id, ${bucket('x.occurred_on')} AS month,
                        SUM(x.amount_cents)::text AS total
                 FROM expenses x
                 WHERE x.status = ANY($1::text[]) AND x.credit_card_id IS NULL
                   AND ${upTo('x.occurred_on')}
                   AND ($4::uuid IS NULL OR x.bank_account_id = $4::uuid)
                 GROUP BY 1, 2`,
                [[...COMPOSITION.expenses.pending], firstDay, lastDay, filter],
            )) as Row[],
            'expensesCents',
        );

        // `+` no destino, `-` na origem; a soma de todas as contas não muda.
        add(
            (await this.dataSource.query(
                `SELECT t.account_id AS id, t.month, SUM(t.amount)::text AS total
                 FROM (
                     SELECT to_bank_account_id AS account_id, ${bucket('occurred_on')} AS month,
                            amount_cents AS amount
                     FROM bank_transfers
                     WHERE status = $1 AND ${upTo('occurred_on')}
                     UNION ALL
                     SELECT from_bank_account_id, ${bucket('occurred_on')}, -amount_cents
                     FROM bank_transfers
                     WHERE status = $1 AND ${upTo('occurred_on')}
                 ) t
                 WHERE ($4::uuid IS NULL OR t.account_id = $4::uuid)
                 GROUP BY 1, 2`,
                [TRANSFER_SCHEDULED, firstDay, lastDay, filter],
            )) as Row[],
            'transfersCents',
        );

        return result;
    }
}
