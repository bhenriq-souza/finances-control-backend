import { inject, injectable } from 'tsyringe';

import { businessToday } from '../platform';
import type { BalanceQuery } from './balance.schemas';
import { cardDebtOn, cardDueIn, type CardDebtService, type CardLedger } from './card-debt.service';
import type { ForecastBalanceService, MonthlyPending } from './forecast-balance.service';
import type { RealizedBalanceService } from './realized-balance.service';
import { monthsInWindow } from './report-window.schemas';
import {
    CardDebtServiceSymbol,
    ForecastBalanceServiceSymbol,
    RealizedBalanceServiceSymbol,
} from './reporting.symbols';

export type BalanceAccountPoint = {
    bankAccountId: string;
    balanceCents: number;
    pendingEarningsCents?: number;
    pendingExpensesCents?: number;
    cardDebtCents?: number;
    balanceAfterCardsCents?: number;
};

export type BalancePoint = {
    month: string;
    kind: 'REALIZED' | 'FORECAST';
    accounts: BalanceAccountPoint[];
    accountsTotalCents: number;
    cardDebtCents: number | null;
    unassignedCardDebtCents: number | null;
    cardDueCents: number | null;
    consolidatedCents: number | null;
};

export type BalanceReport = { from: string; to: string; points: BalancePoint[] };

/** Último dia (`YYYY-MM-DD`) do mês `YYYY-MM`. */
const lastDayOf = (month: string): string =>
    new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
        .toISOString()
        .slice(0, 10);

const nextMonth = (month: string): string => {
    const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));

    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
};

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const EMPTY_PENDING: MonthlyPending = { earningsCents: 0, expensesCents: 0, transfersCents: 0 };

/**
 * `GET /reports/balance` (spec 0015, Série mensal): um ponto por mês, com `D` no último dia.
 * Meses passados são `REALIZED` (saldo realizado, sem dívida de cartão); o corrente e os
 * seguintes são `FORECAST`, com o carry-forward das pendências, a dívida dos cartões descontada
 * da conta pagadora e o consolidado. Somente leitura (INV-0015-01); só inteiros de centavos.
 */
@injectable()
export class BalanceReportService {
    constructor(
        @inject(ForecastBalanceServiceSymbol) private readonly forecast: ForecastBalanceService,
        @inject(CardDebtServiceSymbol) private readonly cardDebt: CardDebtService,
        @inject(RealizedBalanceServiceSymbol) private readonly realized: RealizedBalanceService,
    ) {}

    async balance({ from, to, bankAccountId }: BalanceQuery): Promise<BalanceReport> {
        const currentMonth = businessToday().slice(0, 7);
        const accounts = await this.forecast.accounts(bankAccountId);
        const months = monthsInWindow(from, to);
        const hasForecast = to >= currentMonth;

        const pending = hasForecast
            ? await this.forecast.pendingByMonth(currentMonth, to, bankAccountId)
            : new Map<string, Map<string, MonthlyPending>>();
        const ledgers = hasForecast
            ? await this.cardDebt.ledgers(lastDayOf(to), bankAccountId)
            : [];

        // Carry-forward: o saldo previsto de cada conta, do mês corrente até `to`.
        const running = new Map(accounts.map((a) => [a.id, a.currentBalanceCents]));
        const forecastBalances = new Map<string, Map<string, number>>();
        const details = new Map<string, Map<string, MonthlyPending>>();

        if (hasForecast) {
            for (let month = currentMonth; month <= to; month = nextMonth(month)) {
                const balances = new Map<string, number>();
                const detail = new Map<string, MonthlyPending>();

                for (const account of accounts) {
                    const own = pending.get(account.id)?.get(month) ?? EMPTY_PENDING;
                    const balance =
                        (running.get(account.id) ?? 0) +
                        own.earningsCents -
                        own.expensesCents +
                        own.transfersCents;

                    running.set(account.id, balance);
                    balances.set(account.id, balance);
                    detail.set(account.id, own);
                }

                forecastBalances.set(month, balances);
                details.set(month, detail);
            }
        }

        const points: BalancePoint[] = [];

        for (const month of months) {
            points.push(
                month < currentMonth
                    ? await this.realizedPoint(month, accounts, bankAccountId)
                    : this.forecastPoint(
                          month,
                          accounts.map((a) => a.id),
                          forecastBalances.get(month)!,
                          details.get(month)!,
                          ledgers,
                          bankAccountId,
                      ),
            );
        }

        return { from, to, points };
    }

    private async realizedPoint(
        month: string,
        accounts: Array<{ id: string }>,
        bankAccountId: string | undefined,
    ): Promise<BalancePoint> {
        const date = lastDayOf(month);
        const balances = await Promise.all(
            accounts.map((account) => this.realized.balanceOn(account.id, date)),
        );
        const accountsTotalCents = sum(balances);

        return {
            month,
            kind: 'REALIZED',
            accounts: accounts.map((account, i) => ({
                bankAccountId: account.id,
                balanceCents: balances[i]!,
            })),
            accountsTotalCents,
            cardDebtCents: null,
            unassignedCardDebtCents: null,
            cardDueCents: null,
            // Sem dívida de cartão no passado: o consolidado é o das contas.
            consolidatedCents: bankAccountId === undefined ? accountsTotalCents : null,
        };
    }

    private forecastPoint(
        month: string,
        accountIds: string[],
        balances: Map<string, number>,
        detail: Map<string, MonthlyPending>,
        ledgers: CardLedger[],
        bankAccountId: string | undefined,
    ): BalancePoint {
        const date = lastDayOf(month);
        const debts = ledgers.map((ledger) => ({
            payer: ledger.paymentBankAccountId,
            cents: cardDebtOn(ledger, date),
        }));

        const accounts = accountIds.map((id): BalanceAccountPoint => {
            const balanceCents = balances.get(id)!;
            const own = detail.get(id)!;
            const cardDebtCents = sum(debts.filter((d) => d.payer === id).map((d) => d.cents));

            return {
                bankAccountId: id,
                balanceCents,
                pendingEarningsCents: own.earningsCents,
                pendingExpensesCents: own.expensesCents,
                cardDebtCents,
                balanceAfterCardsCents: balanceCents - cardDebtCents,
            };
        });
        const accountsTotalCents = sum(accounts.map((a) => a.balanceCents));

        if (bankAccountId !== undefined) {
            return {
                month,
                kind: 'FORECAST',
                accounts,
                accountsTotalCents,
                cardDebtCents: null,
                unassignedCardDebtCents: null,
                cardDueCents: null,
                consolidatedCents: null,
            };
        }

        const cardDebtCents = sum(debts.map((d) => d.cents));

        return {
            month,
            kind: 'FORECAST',
            accounts,
            accountsTotalCents,
            cardDebtCents,
            unassignedCardDebtCents: sum(debts.filter((d) => d.payer === null).map((d) => d.cents)),
            cardDueCents: sum(ledgers.map((ledger) => cardDueIn(ledger, month))),
            consolidatedCents: accountsTotalCents - cardDebtCents,
        };
    }
}
