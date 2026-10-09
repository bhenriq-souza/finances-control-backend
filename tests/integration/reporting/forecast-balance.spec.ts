import { stopApp } from '../app.helper';
import {
    addAccount,
    addCard,
    DATE_ONLY,
    getBalance,
    insertEarning,
    insertExpense,
    seedReporting,
    type ReportingFixture,
} from './reporting-fixtures.helper';

const SCHEMA = 'test_reporting_forecast_balance';

/** "Today" is 2026-03-15: February is past, March is current, April and May are ahead. */
describe('saldo previsto por conta e consolidado (spec 0015, AC-0015-02, 03, 06, INV-0015-05)', () => {
    let fx: ReportingFixture;

    beforeAll(async () => {
        fx = await seedReporting(SCHEMA, 120000);
        jest.useFakeTimers({
            now: new Date('2026-03-15T15:00:00.000Z'),
            doNotFake: [...DATE_ONLY],
        });
    });

    afterAll(async () => {
        jest.useRealTimers();
        await stopApp(fx?.ctx, SCHEMA);
    });

    it('AC-0015-02: 1400 no mês corrente e 1750 no seguinte, com carry-forward', async () => {
        await insertEarning(fx, 'OPEN', 30000, '2026-03-20');
        await insertEarning(fx, 'FORECAST', 40000, '2026-04-10');
        await insertExpense(fx, 'OVERDUE', 10000, '2026-02-10', { accountId: fx.accountId });
        await insertExpense(fx, 'OPEN', 5000, '2026-04-12', { accountId: fx.accountId });

        const [march, april] = await getBalance(fx, '2026-03', '2026-04');

        expect(march).toMatchObject({
            month: '2026-03',
            kind: 'FORECAST',
            accountsTotalCents: 140000,
        });
        expect(march!.accounts[0]).toMatchObject({
            bankAccountId: fx.accountId,
            balanceCents: 140000,
            pendingEarningsCents: 30000,
            // A despesa vencida de fevereiro entra no primeiro ponto futuro.
            pendingExpensesCents: 10000,
            cardDebtCents: 0,
            balanceAfterCardsCents: 140000,
        });
        expect(april).toMatchObject({
            month: '2026-04',
            kind: 'FORECAST',
            accountsTotalCents: 175000,
        });
        expect(april!.accounts[0]).toMatchObject({
            balanceCents: 175000,
            pendingEarningsCents: 40000,
            pendingExpensesCents: 5000,
        });
        expect(april!.consolidatedCents).toBe(175000);
    });

    it('INV-0015-05: um FORECAST de data passada entra no previsto e nunca no realizado', async () => {
        const before = await getBalance(fx, '2026-02', '2026-03');

        await insertEarning(fx, 'FORECAST', 70000, '2026-02-05');

        const after = await getBalance(fx, '2026-02', '2026-03');

        expect(after[0]).toMatchObject({ month: '2026-02', kind: 'REALIZED' });
        expect(after[0]!.accountsTotalCents).toBe(before[0]!.accountsTotalCents);
        expect(after[1]!.accountsTotalCents).toBe(before[1]!.accountsTotalCents + 70000);
    });

    it('AC-0015-03: despesa de cartão não move conta nenhuma e entra na dívida do consolidado', async () => {
        const cardId = await addCard(fx, 'Sem pagadora', null);
        const before = await getBalance(fx, '2026-03', '2026-04');

        await insertExpense(fx, 'OPEN', 10000, '2026-03-12', { cardId });

        const after = await getBalance(fx, '2026-03', '2026-04');

        // A compra de 12/03 está na fatura que fecha em 10/04 e vence em 20/04.
        expect(after[0]!.accounts).toEqual(before[0]!.accounts);
        expect(after[0]!.cardDebtCents).toBe(0);
        expect(after[1]!.accounts[0]!.balanceCents).toBe(before[1]!.accounts[0]!.balanceCents);
        expect(after[1]!.cardDebtCents).toBe(10000);
        expect(after[1]!.unassignedCardDebtCents).toBe(10000);
        expect(after[1]!.cardDueCents).toBe(10000);
        expect(after[1]!.consolidatedCents).toBe(after[1]!.accountsTotalCents - 10000);
    });

    it('AC-0015-06: três pontos REALIZED sem dívida e três FORECAST; com bankAccountId, só a conta', async () => {
        await addAccount(fx, '9-9', 50000);
        const points = await getBalance(fx, '2025-12', '2026-05');

        expect(points.map((p) => [p.month, p.kind])).toEqual([
            ['2025-12', 'REALIZED'],
            ['2026-01', 'REALIZED'],
            ['2026-02', 'REALIZED'],
            ['2026-03', 'FORECAST'],
            ['2026-04', 'FORECAST'],
            ['2026-05', 'FORECAST'],
        ]);
        for (const point of points.slice(0, 3)) {
            expect(point).toMatchObject({
                cardDebtCents: null,
                unassignedCardDebtCents: null,
                cardDueCents: null,
            });
            expect(point.accounts).toHaveLength(2);
            expect(point.accounts[0]).not.toHaveProperty('pendingEarningsCents');
        }
        expect(points[3]!.cardDebtCents).not.toBeNull();

        const own = await getBalance(fx, '2025-12', '2026-05', fx.accountId);

        expect(own).toHaveLength(6);
        for (const point of own) {
            expect(point.accounts.map((a) => a.bankAccountId)).toEqual([fx.accountId]);
            expect(point.consolidatedCents).toBeNull();
            expect(point.cardDebtCents).toBeNull();
        }
        expect(own[3]!.accounts[0]!.cardDebtCents).toBe(0);
    });

    it('transferência SCHEDULED soma no destino e subtrai na origem, sem mexer no consolidado', async () => {
        const otherId = await addAccount(fx, '8-8', 0);
        const before = await getBalance(fx, '2026-03', '2026-05');

        // A de 01/03 tem data passada: entra no primeiro ponto futuro (março).
        await fx.ctx.dataSource.query(
            `INSERT INTO bank_transfers (from_bank_account_id, to_bank_account_id, amount_cents,
                                         occurred_on, status, description)
             VALUES ($1, $2, 1, '2026-03-01', 'SCHEDULED', 'Passada'),
                    ($1, $2, 2, '2026-04-05', 'SCHEDULED', 'Futura')`,
            [fx.accountId, otherId],
        );

        const after = await getBalance(fx, '2026-03', '2026-05');
        const balanceOf = (points: typeof after, index: number, id: string): number =>
            points[index]!.accounts.find((a) => a.bankAccountId === id)!.balanceCents;

        expect(balanceOf(after, 0, fx.accountId)).toBe(balanceOf(before, 0, fx.accountId) - 100);
        expect(balanceOf(after, 0, otherId)).toBe(balanceOf(before, 0, otherId) + 100);
        expect(balanceOf(after, 1, fx.accountId)).toBe(balanceOf(before, 1, fx.accountId) - 300);
        expect(balanceOf(after, 1, otherId)).toBe(balanceOf(before, 1, otherId) + 300);
        expect(balanceOf(after, 2, otherId)).toBe(balanceOf(before, 2, otherId) + 300);
        after.forEach((point, i) => {
            expect(point.accountsTotalCents).toBe(before[i]!.accountsTotalCents);
            expect(point.consolidatedCents).toBe(before[i]!.consolidatedCents);
        });
    });
});
