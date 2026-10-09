import { stopApp } from '../app.helper';
import {
    addAccount,
    addCard,
    DATE_ONLY,
    getBalance,
    insertExpense,
    seedReporting,
    type ReportingFixture,
} from './reporting-fixtures.helper';

/** "Today" is 2026-03-15; cards close on the 10th and are due on the 20th. */
describe('dívida dos cartões (spec 0015, AC-0015-04, 05, 13, INV-0015-06)', () => {
    const SCHEMA = 'test_reporting_card_debt';
    let fx: ReportingFixture;
    let otherId: string;
    let creditAccountId: string;

    beforeAll(async () => {
        fx = await seedReporting(SCHEMA, 100000);
        otherId = await addAccount(fx, '9-9', 50000);
        creditAccountId = await addAccount(fx, '7-7', 0);
        const paidCardId = await addCard(fx, 'Paga pela A', fx.accountId);
        const unassignedCardId = await addCard(fx, 'Sem pagadora', null);
        const creditCardId = await addCard(fx, 'Com crédito', creditAccountId);

        // Fatura de 10/03 (vence 20/03): 1100, fechada e sem pagamento.
        await insertExpense(fx, 'OPEN', 110000, '2026-03-03', { cardId: paidCardId });
        // Aberta (fecha 10/04, vence 20/04): 800 de compras e 70 planejados.
        await insertExpense(fx, 'OPEN', 80000, '2026-03-12', { cardId: paidCardId });
        await insertExpense(fx, 'FORECAST', 7000, '2026-03-13', { cardId: paidCardId });
        // Outro cartão, sem conta pagadora: 300 na fatura fechada.
        await insertExpense(fx, 'OPEN', 30000, '2026-03-04', { cardId: unassignedCardId });

        // Cartão com crédito: 11/01-10/02 rolada (as compras dela não contam) e 11/02-10/03
        // paga com restante -200 (um estorno de 200 e nenhuma compra).
        await fx.ctx.dataSource.query(
            `INSERT INTO credit_card_statements (credit_card_id, starts_on, closes_on, due_on,
                                                 status, previous_balance_cents, closed_at)
             VALUES ($1, '2026-01-11', '2026-02-10', '2026-02-20', 'ROLLED_OVER', 0, now()),
                    ($1, '2026-02-11', '2026-03-10', '2026-03-20', 'PAID', 0, now())`,
            [creditCardId],
        );
        await insertExpense(fx, 'OPEN', 50000, '2026-01-20', { cardId: creditCardId });
        await fx.ctx.dataSource.query(
            `INSERT INTO credit_card_refunds (credit_card_id, description, amount_cents,
                                              occurred_on, posted_on)
             VALUES ($1, 'Estorno', 200, '2026-02-20', '2026-02-20')`,
            [creditCardId],
        );

        jest.useFakeTimers({
            now: new Date('2026-03-15T15:00:00.000Z'),
            doNotFake: [...DATE_ONLY],
        });

        // Fecha as faturas vencidas antes do pagamento antecipado, que só vale para a aberta.
        await getBalance(fx, '2026-03', '2026-03');
        await fx.ctx.dataSource.query(
            `INSERT INTO credit_card_statement_payments (credit_card_id, bank_account_id,
                                                         amount_cents, paid_on)
             VALUES ($1, $2, 50, '2026-03-14')`,
            [paidCardId, fx.accountId],
        );
    });

    afterAll(async () => {
        jest.useRealTimers();
        await stopApp(fx?.ctx, SCHEMA);
    });

    it('AC-0015-04: 1100 antes do vencimento da aberta e 1920 a partir dele, sem repetir o saldo anterior', async () => {
        const points = await getBalance(fx, '2026-03', '2026-05', fx.accountId);

        // Em 31/03 só a fechada (1100); em 30/04 a aberta soma 800 - 50 + 70 = 820 (INV-0015-06).
        expect(points.map((p) => p.accounts[0]!.cardDebtCents)).toEqual([110000, 192000, 192000]);
    });

    it('AC-0015-13: a dívida reduz só a conta pagadora; sem pagadora, vai a unassigned e ao consolidado', async () => {
        const points = await getBalance(fx, '2026-03', '2026-05');
        const april = points[1]!;
        const accountA = april.accounts.find((a) => a.bankAccountId === fx.accountId)!;
        const accountB = april.accounts.find((a) => a.bankAccountId === otherId)!;

        expect(accountA.cardDebtCents).toBe(192000);
        expect(accountA.balanceAfterCardsCents).toBe(accountA.balanceCents - 192000);
        expect(accountB.cardDebtCents).toBe(0);
        expect(accountB.balanceAfterCardsCents).toBe(accountB.balanceCents);
        expect(april.unassignedCardDebtCents).toBe(30000);
        // 1920 + 300 - 200 do crédito.
        expect(april.cardDebtCents).toBe(202000);
        expect(april.consolidatedCents).toBe(april.accountsTotalCents - 202000);
        // As duas fechadas vencem em março; a aberta vence em abril.
        expect(points.map((p) => p.cardDueCents)).toEqual([140000, 82000, 0]);
    });

    it('AC-0015-05: a ROLLED_OVER não entra e o crédito da PAID reduz a dívida em 200', async () => {
        const [march, april] = await getBalance(fx, '2026-03', '2026-04', creditAccountId);

        expect(march!.accounts[0]!.cardDebtCents).toBe(-20000);
        expect(april!.accounts[0]!.cardDebtCents).toBe(-20000);
        expect(april!.accounts[0]!.balanceAfterCardsCents).toBe(20000);
    });
});
