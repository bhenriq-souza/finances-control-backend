import { stopApp } from '../app.helper';
import {
    realizedBalanceService,
    seedReporting,
    type ReportingFixture,
} from './reporting-fixtures.helper';

const SCHEMA = 'test_reporting_precision';
const OPENING = 123456789;

describe('precisão do saldo realizado (spec 0015, AC-0015-12, INV-0015-04)', () => {
    let fx: ReportingFixture;

    beforeAll(async () => {
        fx = await seedReporting(SCHEMA, OPENING);
    });

    afterAll(async () => {
        await stopApp(fx?.ctx, SCHEMA);
    });

    it('1000 lançamentos com centavos somam exatamente a soma dos inteiros de centavos', async () => {
        // Valores como 0,01 e 0,07 não têm representação exata em ponto flutuante: 1000 somas
        // em `number` derivariam, e a conferência por inteiros expõe a diferença.
        const amounts = Array.from({ length: 1000 }, (_, i) => ((i * 37) % 997) + 1 + (i % 7) * 10);
        const earnings = amounts.filter((_, i) => i % 2 === 0);
        const expenses = amounts.filter((_, i) => i % 2 === 1);
        const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

        await fx.ctx.dataSource.query(
            `INSERT INTO earnings (description, earning_type_id, kind, status, amount_cents,
                                   occurred_on, received_on, bank_account_id)
             SELECT 'Receita', $1, 'VARIABLE', 'RECEIVED', v::numeric / 100,
                    '2026-03-10', '2026-03-10', $2
             FROM unnest($3::int[]) AS v`,
            [fx.earningTypeId, fx.accountId, earnings],
        );
        await fx.ctx.dataSource.query(
            `INSERT INTO expenses (description, expense_type_id, kind, status, amount_cents,
                                   occurred_on, paid_on, bank_account_id)
             SELECT 'Despesa', $1, 'VARIABLE', 'PAID', v::numeric / 100,
                    '2026-03-10', '2026-03-10', $2
             FROM unnest($3::int[]) AS v`,
            [fx.expenseTypeId, fx.accountId, expenses],
        );

        const balance = await realizedBalanceService().balanceOn(fx.accountId, '2026-03-31');

        expect(Number.isInteger(balance)).toBe(true);
        expect(balance).toBe(OPENING + sum(earnings) - sum(expenses));
        expect(await realizedBalanceService().balanceOn(fx.accountId, '2026-03-09')).toBe(OPENING);
    });
});
