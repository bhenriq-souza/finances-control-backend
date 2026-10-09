import { CustomError } from '@bhs-dev/typescript-common-errors';
import { inject, injectable } from 'tsyringe';
import type { DataSource } from 'typeorm';

import { DatabaseConnectionSymbol, moneyTransformer } from '../platform';
import { EARNING_REALIZED, EXPENSE_REALIZED } from './composition';
import { monthsInWindow } from './report-window.schemas';

export type CashFlowAccount = {
    bankAccountId: string;
    inflowsCents: number;
    expensesPaidCents: number;
    statementPaymentsCents: number;
    transfersInCents: number;
    transfersOutCents: number;
    netCents: number;
};

export type CashFlowMonth = { month: string; accounts: CashFlowAccount[]; netCents: number };

export type CashFlowReport = { from: string; to: string; months: CashFlowMonth[] };

type Params = { from: string; to: string; bankAccountId?: string | undefined };

type Kind = 'inflows' | 'expensesPaid' | 'statementPayments' | 'transfersIn' | 'transfersOut';

type Row = { month: string; account_id: string; kind: Kind; total: string };

/**
 * Fluxo de caixa realizado por mês e por conta (spec 0015, AC-0015-09, emenda da spec 0018):
 * só o dinheiro que de fato se moveu, cada coluna pela sua data de movimento. Os status vêm
 * da regra de composição (INV-0015-02); `FORECAST` e pendências nunca entram (INV-0015-05).
 *
 * Todas as contas aparecem em todos os meses da janela, arquivadas inclusive e com zeros, na
 * ordem de criação — a mesma cobertura da série de saldo. Somas em `numeric` no banco,
 * convertidas em inteiro de centavos na fronteira (INV-0015-04). Somente leitura, por SQL
 * próprio (INV-0015-01).
 */
@injectable()
export class CashFlowReportService {
    constructor(@inject(DatabaseConnectionSymbol) private readonly dataSource: DataSource) {}

    async cashFlow({ from, to, bankAccountId }: Params): Promise<CashFlowReport> {
        const accountIds = await this.accountIds(bankAccountId);
        const start = `${from}-01`;
        const end = `${to}-01`;

        const rows = (await this.dataSource.query(
            `SELECT to_char(day, 'YYYY-MM') AS month, account_id, kind, SUM(amount)::text AS total
             FROM (
                SELECT e.bank_account_id AS account_id, 'inflows' AS kind,
                       e.amount_cents AS amount, e.received_on AS day
                FROM earnings e WHERE e.status = ANY($3::text[])
              UNION ALL
                SELECT x.bank_account_id, 'expensesPaid', x.amount_cents, x.paid_on
                FROM expenses x WHERE x.status = ANY($4::text[]) AND x.bank_account_id IS NOT NULL
              UNION ALL
                SELECT p.bank_account_id, 'statementPayments', p.amount_cents, p.paid_on
                FROM credit_card_statement_payments p
              UNION ALL
                SELECT t.to_bank_account_id, 'transfersIn', t.amount_cents, t.completed_on
                FROM bank_transfers t WHERE t.status = 'COMPLETED'
              UNION ALL
                SELECT t.from_bank_account_id, 'transfersOut', t.amount_cents, t.completed_on
                FROM bank_transfers t WHERE t.status = 'COMPLETED'
             ) moves
             WHERE day >= $1::date AND day < ($2::date + interval '1 month')
               AND account_id = ANY($5::uuid[])
             GROUP BY 1, account_id, kind`,
            [start, end, [...EARNING_REALIZED], [...EXPENSE_REALIZED], accountIds],
        )) as Row[];

        const totals = new Map<string, number>();

        for (const row of rows) {
            totals.set(
                `${row.month}|${row.account_id}|${row.kind}`,
                moneyTransformer.from(row.total) as number,
            );
        }

        const months = monthsInWindow(from, to).map((month): CashFlowMonth => {
            const accounts = accountIds.map((id): CashFlowAccount => {
                const pick = (kind: Kind): number => totals.get(`${month}|${id}|${kind}`) ?? 0;
                const inflowsCents = pick('inflows');
                const expensesPaidCents = pick('expensesPaid');
                const statementPaymentsCents = pick('statementPayments');
                const transfersInCents = pick('transfersIn');
                const transfersOutCents = pick('transfersOut');

                return {
                    bankAccountId: id,
                    inflowsCents,
                    expensesPaidCents,
                    statementPaymentsCents,
                    transfersInCents,
                    transfersOutCents,
                    netCents:
                        inflowsCents +
                        transfersInCents -
                        expensesPaidCents -
                        statementPaymentsCents -
                        transfersOutCents,
                };
            });

            return {
                month,
                accounts,
                netCents: accounts.reduce((sum, account) => sum + account.netCents, 0),
            };
        });

        return { from, to, months };
    }

    /** Contas do relatório: todas (arquivadas inclusive) ou a pedida, que deve existir. */
    private async accountIds(bankAccountId?: string): Promise<string[]> {
        const rows = (await this.dataSource.query(
            `SELECT id FROM bank_accounts WHERE ($1::uuid IS NULL OR id = $1::uuid)
             ORDER BY created_at, id`,
            [bankAccountId ?? null],
        )) as Array<{ id: string }>;

        if (bankAccountId && rows.length === 0) {
            throw CustomError.notFound('Bank account not found', 'BANK_ACCOUNT_NOT_FOUND', {
                exposeMessage: true,
            });
        }

        return rows.map((row) => row.id);
    }
}
