import request from 'supertest';

import { container } from '../../../src/container';
import { ExpenseServiceSymbol, type ExpenseService } from '../../../src/expenses';
import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_expenses_overdue';
const ADMIN = 'Bearer uid-admin';

describe('despesa: varredura de vencidas (spec 0012, AC-0012-11)', () => {
    let ctx: TestApp;
    let accountId: string;
    let cardId: string;
    let typeId: string;
    let service: ExpenseService;

    const send = (path: string, body: Record<string, unknown>) =>
        request(ctx.app).post(path).set('Authorization', ADMIN).send(body);

    const create = async (overrides: Record<string, unknown> = {}): Promise<string> =>
        (
            await send('/expenses', {
                description: 'Conta',
                expenseTypeId: typeId,
                kind: 'FIXED',
                amountCents: 10000,
                occurredOn: '2026-03-10',
                bankAccountId: accountId,
                ...overrides,
            })
        ).body.data[0].id as string;

    const statusOf = async (id: string): Promise<string> =>
        (
            (await ctx.dataSource.query('SELECT status FROM expenses WHERE id = $1', [id])) as [
                { status: string },
            ]
        )[0].status;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        service = container.resolve<ExpenseService>(ExpenseServiceSymbol);
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

    it('AC-0012-11, INV-0012-08: vence só despesa de conta OPEN anterior a asOf, ignora cartão e FORECAST, e a segunda chamada devolve 0', async () => {
        const due = await create({ occurredOn: '2026-03-09' });
        const dueToo = await create({ occurredOn: '2026-01-15' });
        const today = await create({ occurredOn: '2026-03-10' });
        const future = await create({ occurredOn: '2026-03-20' });
        const forecast = await create({ occurredOn: '2026-03-01', status: 'FORECAST' });
        const verifying = await create({ occurredOn: '2026-03-01', status: 'VERIFYING' });
        const card = await create({
            bankAccountId: undefined,
            creditCardId: cardId,
            occurredOn: '2026-03-01',
        });
        const paid = await create({ occurredOn: '2026-03-01' });
        await request(ctx.app)
            .patch(`/expenses/${paid}/status`)
            .set('Authorization', ADMIN)
            .send({ status: 'PAID' });

        const changed = await service.markOverdue(new Date('2026-03-10T15:00:00Z'));

        expect(changed).toBe(2);
        expect(await statusOf(due)).toBe('OVERDUE');
        expect(await statusOf(dueToo)).toBe('OVERDUE');
        expect(await statusOf(today)).toBe('OPEN');
        expect(await statusOf(future)).toBe('OPEN');
        expect(await statusOf(forecast)).toBe('FORECAST');
        expect(await statusOf(verifying)).toBe('VERIFYING');
        expect(await statusOf(card)).toBe('OPEN');
        expect(await statusOf(paid)).toBe('PAID');

        expect(await service.markOverdue(new Date('2026-03-10T15:00:00Z'))).toBe(0);
    }, 30_000);

    it('INV-0012-04: a varredura não move o saldo e a despesa vencida ainda pode ser paga', async () => {
        const id = await create({ occurredOn: '2026-03-01' });
        await service.markOverdue(new Date('2026-03-10T15:00:00Z'));

        const balance = async () =>
            (await request(ctx.app).get(`/bank-accounts/${accountId}`).set('Authorization', ADMIN))
                .body.data.currentBalanceCents as number;

        expect(await balance()).toBe(100000);

        const res = await request(ctx.app)
            .patch(`/expenses/${id}/status`)
            .set('Authorization', ADMIN)
            .send({ status: 'PAID' });

        expect(res.status).toBe(200);
        expect(await balance()).toBe(90000);
    });
});
