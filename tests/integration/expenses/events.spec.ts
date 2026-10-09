import request from 'supertest';

import { container } from '../../../src/container';
import { EXPENSE_CREATED, type ExpenseCreated } from '../../../src/events';
import {
    DomainEventDispatcherSymbol,
    businessToday,
    type DomainEventDispatcher,
} from '../../../src/platform';
import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_expenses_events';
const ADMIN = 'Bearer uid-admin';

describe('evento ExpenseCreated (spec 0012, AC-0012-19)', () => {
    let ctx: TestApp;
    let accountId: string;
    let cardId: string;
    let typeId: string;
    let received: ExpenseCreated[];
    let unsubscribe: () => void;
    let rowsSeenByHandler: number[];

    const send = (path: string, body: Record<string, unknown>) =>
        request(ctx.app).post(path).set('Authorization', ADMIN).send(body);

    const create = (overrides: Record<string, unknown> = {}) =>
        send('/expenses', {
            description: 'Compra',
            expenseTypeId: typeId,
            kind: 'FIXED',
            amountCents: 20000,
            occurredOn: '2026-03-10',
            bankAccountId: accountId,
            ...overrides,
        });

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

        received = [];
        rowsSeenByHandler = [];
        unsubscribe = container
            .resolve<DomainEventDispatcher>(DomainEventDispatcherSymbol)
            .subscribe<ExpenseCreated>(EXPENSE_CREATED, async (event) => {
                received.push(event);

                const [row] = (await ctx.dataSource.query(
                    'SELECT count(*)::int AS n FROM expenses WHERE id = $1',
                    [event.payload.expenseId],
                )) as [{ n: number }];
                rowsSeenByHandler.push(row.n);
            });
    });

    afterEach(async () => {
        unsubscribe();
        await ctx.dataSource.query('DELETE FROM expenses');
        await ctx.dataSource.query('DELETE FROM expense_recurrences');
        await ctx.dataSource.query("DELETE FROM expense_types WHERE name LIKE 'T-%'");
        await ctx.dataSource.query('DELETE FROM credit_cards');
        await ctx.dataSource.query('DELETE FROM bank_accounts');
        await ctx.dataSource.query('DELETE FROM banks');
    });

    it('AC-0012-19: publica uma vez, com o payload da spec, para despesa de conta', async () => {
        const res = await create({ status: 'FORECAST' });

        expect(res.status).toBe(201);
        // FIXED gera a série (spec 0017): um evento por ocorrência criada.
        expect(received).toHaveLength(res.body.data.length);
        expect(received[0]?.name).toBe('ExpenseCreated');
        expect(received[0]?.payload).toEqual({
            expenseId: res.body.data[0].id,
            kind: 'FIXED',
            status: 'FORECAST',
            amountCents: 20000,
            occurredOn: '2026-03-10',
            bankAccountId: accountId,
            creditCardId: null,
            postedOn: null,
            installmentGroupId: null,
        });
    });

    it('AC-0012-19: despesa de cartão leva creditCardId e postedOn', async () => {
        const today = businessToday();
        const res = await create({
            bankAccountId: undefined,
            creditCardId: cardId,
            occurredOn: today,
            postedOn: today,
        });

        expect(res.status).toBe(201);
        expect(received).toHaveLength(res.body.data.length);
        expect(received[0]?.payload).toMatchObject({
            expenseId: res.body.data[0].id,
            status: 'OPEN',
            bankAccountId: null,
            creditCardId: cardId,
            postedOn: today,
        });
    });

    it('AC-0012-19, INV-0004-01: o handler só roda depois do commit e já enxerga a linha', async () => {
        const res = await create();

        expect(rowsSeenByHandler).toEqual(res.body.data.map(() => 1));
    });

    it('AC-0012-19, INV-0004-02: criação recusada não publica evento', async () => {
        const res = await create({ expenseTypeId: '00000000-0000-4000-8000-000000000000' });

        expect(res.status).toBe(404);
        expect(received).toHaveLength(0);
    });
});
