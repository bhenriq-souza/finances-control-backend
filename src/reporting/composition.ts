/**
 * Regra de composição (spec 0015): a única definição de "realizado", "pendente" e
 * "comprometido" do sistema (INV-0015-02). Todo relatório do módulo importa daqui;
 * nenhum outro arquivo escreve um status literal de despesa ou receita.
 */

export const EXPENSE_REALIZED = ['PAID'] as const;
export const EXPENSE_PENDING = ['OPEN', 'VERIFYING', 'OVERDUE', 'FORECAST'] as const;
export const EXPENSE_COMMITTED = ['OPEN', 'VERIFYING', 'OVERDUE', 'PAID'] as const;

// O planejado: entra no previsto e, com `includeForecast`, nos relatórios por tipo.
export const EXPENSE_FORECAST = ['FORECAST'] as const;

export const EARNING_REALIZED = ['RECEIVED'] as const;
export const EARNING_PENDING = ['OPEN', 'VERIFYING', 'OVERDUE', 'FORECAST'] as const;
export const EARNING_COMMITTED = ['OPEN', 'VERIFYING', 'OVERDUE', 'RECEIVED'] as const;

// O planejado: entra no previsto e, com `includeForecast`, nos relatórios por tipo.
export const EARNING_FORECAST = ['FORECAST'] as const;

export const COMPOSITION = {
    expenses: {
        realized: EXPENSE_REALIZED,
        pending: EXPENSE_PENDING,
        committed: EXPENSE_COMMITTED,
        forecast: EXPENSE_FORECAST,
    },
    earnings: {
        realized: EARNING_REALIZED,
        pending: EARNING_PENDING,
        committed: EARNING_COMMITTED,
        forecast: EARNING_FORECAST,
    },
} as const;
