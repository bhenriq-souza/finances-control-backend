import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../app.helper';
import {
    ADMIN,
    cleanFixture,
    insertExpense,
    seedFixture,
    type Fixture,
} from '../expenses/fixture.helper';

const SCHEMA = 'test_statements_payment_default_account';

const at = (iso: string): Date => new Date(`${iso}T15:00:00.000Z`);

const DATE_ONLY = [
    'hrtime',
    'nextTick',
    'performance',
    'queueMicrotask',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'requestIdleCallback',
    'cancelIdleCallback',
    'setImmediate',
    'clearImmediate',
    'setInterval',
    'clearInterval',
    'setTimeout',
    'clearTimeout',
] as const;

/** "Today" is 2026-02-11: the statement closed on 2026-02-10 (closing day 10). */
describe('conta pagadora como default do pagamento (spec 0013, Pagamento)', () => {
    let ctx: TestApp;
    let fx: Fixture;
    let otherAccountId: string;

    const balanceOf = async (accountId: string): Promise<number> =>
        Math.round(
            Number(
                (
                    (await ctx.dataSource.query(
                        'SELECT current_balance_cents AS v FROM bank_accounts WHERE id = $1',
                        [accountId],
                    )) as [{ v: string }]
                )[0].v,
            ) * 100,
        );

    const setPayingAccount = async (accountId: string | null): Promise<void> => {
        await ctx.dataSource.query('UPDATE credit_cards SET payment_bank_account_id = $1', [
            accountId,
        ]);
    };

    const closedStatementId = async (): Promise<string> => {
        const res = await request(ctx.app)
            .get(`/statements?creditCardId=${fx.cardId}&from=2026-02-10&to=2026-02-10`)
            .set('Authorization', ADMIN);

        return (res.body.data as { id: string; closesOn: string }[]).find(
            (statement) => statement.closesOn === '2026-02-10',
        )!.id;
    };

    const pay = (id: string, body: Record<string, unknown>) =>
        request(ctx.app).post(`/statements/${id}/payments`).set('Authorization', ADMIN).send(body);

    const early = (body: Record<string, unknown>) =>
        request(ctx.app)
            .post('/statements/current/payments')
            .set('Authorization', ADMIN)
            .send({ creditCardId: fx.cardId, ...body });

    const expense = (postedOn: string, amountCents: number): Promise<string> =>
        insertExpense(ctx, {
            typeId: fx.typeId,
            cardId: fx.cardId,
            occurredOn: postedOn,
            amountCents,
        });

    const paymentAccounts = async (): Promise<string[]> =>
        (
            (await ctx.dataSource.query(
                'SELECT bank_account_id FROM credit_card_statement_payments',
            )) as { bank_account_id: string }[]
        ).map((row) => row.bank_account_id);

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        fx = await seedFixture(ctx);

        const bankId = (
            (await ctx.dataSource.query('SELECT id FROM banks LIMIT 1')) as { id: string }[]
        )[0]!.id;

        otherAccountId = (
            await request(ctx.app).post('/bank-accounts').set('Authorization', ADMIN).send({
                bankId,
                type: 'CHECKING',
                accountNumber: '9-9',
                description: 'Outra conta',
                openingBalanceCents: 100000,
            })
        ).body.data.id as string;

        await ctx.dataSource.query(
            "UPDATE credit_cards SET closing_day = 10, due_day = 20, created_at = '2026-01-15T12:00:00Z'",
        );
        jest.useFakeTimers({ now: at('2026-02-11'), doNotFake: [...DATE_ONLY] });
    });

    afterAll(async () => {
        jest.useRealTimers();
        await cleanFixture(ctx);
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(() => {
        jest.setSystemTime(at('2026-02-11'));
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM credit_card_statement_payments');
        await ctx.dataSource.query('DELETE FROM credit_card_statements');
        await ctx.dataSource.query('DELETE FROM expenses');
        await ctx.dataSource.query(
            'UPDATE credit_cards SET available_limit_cents = 400, archived_at = NULL, payment_bank_account_id = NULL',
        );
        await ctx.dataSource.query(
            'UPDATE bank_accounts SET current_balance_cents = 1000, archived_at = NULL',
        );
    });

    it('pagamento sem bankAccountId debita a conta pagadora do cartão', async () => {
        await expense('2026-02-03', 1500);
        await setPayingAccount(fx.accountId);

        const res = await pay(await closedStatementId(), { amountCents: 500 });

        expect(res.status).toBe(201);
        expect(await balanceOf(fx.accountId)).toBe(100000 - 500);
        expect(await balanceOf(otherAccountId)).toBe(100000);
        expect(await paymentAccounts()).toEqual([fx.accountId]);
    });

    it('o bankAccountId informado vence a conta pagadora', async () => {
        await expense('2026-02-03', 1500);
        await setPayingAccount(fx.accountId);

        const res = await pay(await closedStatementId(), {
            amountCents: 500,
            bankAccountId: otherAccountId,
        });

        expect(res.status).toBe(201);
        expect(await balanceOf(otherAccountId)).toBe(100000 - 500);
        expect(await balanceOf(fx.accountId)).toBe(100000);
    });

    it('pagamento sem bankAccountId e sem conta pagadora é 400 citando bankAccountId', async () => {
        await expense('2026-02-03', 1500);

        const res = await pay(await closedStatementId(), { amountCents: 500 });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(JSON.stringify(res.body)).toContain('bankAccountId');
        expect(await paymentAccounts()).toEqual([]);
    });

    it('conta pagadora arquivada é recusada com 409 BANK_ACCOUNT_ARCHIVED', async () => {
        await expense('2026-02-03', 1500);
        await setPayingAccount(fx.accountId);

        const id = await closedStatementId();

        await ctx.dataSource.query('UPDATE bank_accounts SET archived_at = now() WHERE id = $1', [
            fx.accountId,
        ]);

        const res = await pay(id, { amountCents: 500 });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('BANK_ACCOUNT_ARCHIVED');
        expect(await paymentAccounts()).toEqual([]);
    });

    it('antecipado sem bankAccountId debita a conta pagadora do cartão', async () => {
        await expense('2026-02-15', 1500);
        jest.setSystemTime(at('2026-02-20'));
        await setPayingAccount(fx.accountId);

        const res = await early({ amountCents: 500 });

        expect(res.status).toBe(201);
        expect(await balanceOf(fx.accountId)).toBe(100000 - 500);
        expect(await paymentAccounts()).toEqual([fx.accountId]);
    });

    it('antecipado com bankAccountId informado vence a conta pagadora', async () => {
        await expense('2026-02-15', 1500);
        jest.setSystemTime(at('2026-02-20'));
        await setPayingAccount(fx.accountId);

        const res = await early({ amountCents: 500, bankAccountId: otherAccountId });

        expect(res.status).toBe(201);
        expect(await balanceOf(otherAccountId)).toBe(100000 - 500);
        expect(await balanceOf(fx.accountId)).toBe(100000);
    });

    it('antecipado sem bankAccountId e sem conta pagadora é 400 citando bankAccountId', async () => {
        await expense('2026-02-15', 1500);
        jest.setSystemTime(at('2026-02-20'));

        const res = await early({ amountCents: 500 });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(JSON.stringify(res.body)).toContain('bankAccountId');
        expect(await paymentAccounts()).toEqual([]);
    });

    it('antecipado com conta pagadora arquivada é 409 BANK_ACCOUNT_ARCHIVED', async () => {
        await expense('2026-02-15', 1500);
        jest.setSystemTime(at('2026-02-20'));
        await setPayingAccount(fx.accountId);
        await ctx.dataSource.query('UPDATE bank_accounts SET archived_at = now() WHERE id = $1', [
            fx.accountId,
        ]);

        const res = await early({ amountCents: 500 });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('BANK_ACCOUNT_ARCHIVED');
    });
});
