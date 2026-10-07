import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_expenses_balance_limit';
const ADMIN = 'Bearer uid-admin';

describe('despesa: reflexo em saldo e limite (spec 0012)', () => {
    let ctx: TestApp;
    let accountId: string;
    let cardId: string;
    let typeId: string;

    const send = (path: string, body: Record<string, unknown>) =>
        request(ctx.app).post(path).set('Authorization', ADMIN).send(body);

    const create = (overrides: Record<string, unknown> = {}) =>
        send('/expenses', {
            description: 'Compra',
            expenseTypeId: typeId,
            kind: 'VARIABLE',
            amountCents: 20000,
            occurredOn: '2026-03-10',
            ...overrides,
        });

    const onAccount = (overrides: Record<string, unknown> = {}) =>
        create({ bankAccountId: accountId, ...overrides });
    const onCard = (overrides: Record<string, unknown> = {}) =>
        create({ creditCardId: cardId, ...overrides });

    const balance = async (): Promise<number> => {
        const { body } = await request(ctx.app)
            .get(`/bank-accounts/${accountId}`)
            .set('Authorization', ADMIN);

        return body.data.currentBalanceCents as number;
    };

    const limit = async (): Promise<number> => {
        const { body } = await request(ctx.app)
            .get(`/credit-cards/${cardId}`)
            .set('Authorization', ADMIN);

        return body.data.availableLimitCents as number;
    };

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        await request(ctx.app).get('/users/me').set('Authorization', ADMIN);
        await ctx.setProfile('uid-admin', 'ADMIN');

        const bank = await send('/banks', { febrabanCode: '260', name: 'Nu Pagamentos' });
        const bankId = bank.body.data.id as string;
        accountId = (
            await send('/bank-accounts', {
                bankId,
                type: 'CHECKING',
                accountNumber: '1-1',
                description: 'Conta',
                openingBalanceCents: 100000,
            })
        ).body.data.id as string;
        cardId = (
            await send('/credit-cards', {
                bankId,
                name: 'Platinum',
                creditLimitCents: 50000,
                closingDay: 28,
                dueDay: 5,
            })
        ).body.data.id as string;
        typeId = (await send('/expense-types', { name: 'T-Mercado' })).body.data.id as string;
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM expenses');
        await ctx.dataSource.query("DELETE FROM expense_types WHERE name LIKE 'T-%'");
        await ctx.dataSource.query('DELETE FROM credit_cards');
        await ctx.dataSource.query('DELETE FROM bank_accounts');
        await ctx.dataSource.query('DELETE FROM banks');
    });

    it('AC-0012-03, INV-0012-04: despesa VARIABLE de conta OPEN devolve 201 com um elemento e não move o saldo', async () => {
        const res = await onAccount();

        expect(res.status).toBe(201);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toMatchObject({ status: 'OPEN', bankAccountId: accountId });
        expect(await balance()).toBe(100000);
    });

    it.each(['FORECAST', 'VERIFYING'])(
        'INV-0012-04: despesa de conta %s não move o saldo',
        async (status) => {
            expect((await onAccount({ status })).status).toBe(201);
            expect(await balance()).toBe(100000);
        },
    );

    it('AC-0012-04, INV-0012-03: despesa de cartão OPEN abate o limite disponível', async () => {
        expect((await onCard()).status).toBe(201);

        expect(await limit()).toBe(30000);
    });

    it('INV-0012-03: despesa de cartão VERIFYING abate o limite como OPEN', async () => {
        expect((await onCard({ status: 'VERIFYING' })).status).toBe(201);

        expect(await limit()).toBe(30000);
    });

    it('AC-0012-04, INV-0012-08: despesa de cartão FORECAST não abate o limite', async () => {
        expect((await onCard({ status: 'FORECAST' })).status).toBe(201);

        expect(await limit()).toBe(50000);
        expect(await balance()).toBe(100000);
    });

    it('INV-0012-03: duas despesas somam no limite', async () => {
        await onCard({ amountCents: 10000 });
        await onCard({ amountCents: 15000 });

        expect(await limit()).toBe(25000);
    });

    it('INV-0012-03, ADR-0003 regra 4: criações concorrentes no mesmo cartão não perdem atualização', async () => {
        const results = await Promise.all([
            onCard({ amountCents: 10000 }),
            onCard({ amountCents: 10000 }),
            onCard({ amountCents: 10000 }),
        ]);

        expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
        expect(await limit()).toBe(20000);
    });

    it('AC-0012-17, INV-0012-09: despesa maior que o limite disponível é aceita e o disponível fica negativo', async () => {
        const res = await onCard({ amountCents: 80000 });

        expect(res.status).toBe(201);
        expect(await limit()).toBe(-30000);
    });

    it('AC-0012-17, INV-0012-09: despesa maior que o saldo da conta é aceita', async () => {
        const res = await onAccount({ amountCents: 900000 });

        expect(res.status).toBe(201);
        expect(await balance()).toBe(100000);
    });
});
