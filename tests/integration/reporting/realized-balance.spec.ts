import { stopApp } from '../app.helper';
import {
    currentBalanceCents,
    insertStatementPayment,
    payExpense,
    realizedBalanceService,
    receiveEarning,
    seedReporting,
    type ReportingFixture,
} from './reporting-fixtures.helper';

const SCHEMA = 'test_reporting_realized_balance';

describe('saldo realizado de uma conta (spec 0015, AC-0015-01, INV-0015-03)', () => {
    let fx: ReportingFixture;

    beforeAll(async () => {
        fx = await seedReporting(SCHEMA, 100000);
    });

    afterAll(async () => {
        await stopApp(fx?.ctx, SCHEMA);
    });

    it('AC-0015-01: 1000 em 09/03, 1500 em 10/03 e 1200 em 31/03, igual ao saldo corrente', async () => {
        await receiveEarning(fx, 50000, '2026-03-10');
        await payExpense(fx, 20000, '2026-03-15');
        await insertStatementPayment(fx, 10000, '2026-03-20');
        const service = realizedBalanceService();

        expect(await service.balanceOn(fx.accountId, '2026-03-09')).toBe(100000);
        expect(await service.balanceOn(fx.accountId, '2026-03-10')).toBe(150000);
        expect(await service.balanceOn(fx.accountId, '2026-03-14')).toBe(150000);
        expect(await service.balanceOn(fx.accountId, '2026-03-15')).toBe(130000);
        expect(await service.balanceOn(fx.accountId, '2026-03-20')).toBe(120000);
        expect(await service.balanceOn(fx.accountId, '2026-03-31')).toBe(120000);
        expect(await service.balanceOn(fx.accountId, '2026-03-31')).toBe(
            await currentBalanceCents(fx),
        );
    });

    it('INV-0015-03: no dia de hoje bate com o saldo corrente', async () => {
        const today = new Date().toISOString().slice(0, 10);

        expect(await realizedBalanceService().balanceOn(fx.accountId, today)).toBe(
            await currentBalanceCents(fx),
        );
    });

    it('não conta pendências nem despesa de cartão: só o realizado', async () => {
        const before = await realizedBalanceService().balanceOn(fx.accountId, '2026-12-31');

        await fx.ctx.dataSource.query(
            `INSERT INTO earnings (description, earning_type_id, kind, status, amount_cents, occurred_on, bank_account_id)
             VALUES ('Aberta', $1, 'VARIABLE', 'OPEN', 999.99, '2026-03-12', $2)`,
            [fx.earningTypeId, fx.accountId],
        );
        await fx.ctx.dataSource.query(
            `INSERT INTO expenses (description, expense_type_id, kind, status, amount_cents, occurred_on, credit_card_id, posted_on)
             VALUES ('Cartão', $1, 'VARIABLE', 'OPEN', 77.77, '2026-03-12', $2, '2026-03-12')`,
            [fx.expenseTypeId, fx.cardId],
        );

        expect(await realizedBalanceService().balanceOn(fx.accountId, '2026-12-31')).toBe(before);
    });

    it('conta inexistente é BANK_ACCOUNT_NOT_FOUND', async () => {
        await expect(
            realizedBalanceService().balanceOn(
                '00000000-0000-4000-8000-000000000000',
                '2026-03-31',
            ),
        ).rejects.toMatchObject({ code: 'BANK_ACCOUNT_NOT_FOUND' });
    });
});
