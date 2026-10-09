import request from 'supertest';
import { CustomError } from '@bhs-dev/typescript-common-errors';

import { container } from '../../../src/container';
import {
    ExpenseRecurrenceServiceSymbol,
    ExpenseServiceSymbol,
    type ExpenseRecurrenceService,
    type ExpenseService,
} from '../../../src/expenses';
import { startApp, stopApp, type TestApp } from '../app.helper';
import { ADMIN, cleanFixture, insertExpense, seedFixture, type Fixture } from './fixture.helper';

const SCHEMA = 'test_expenses_recurrence_promotion';
const FAKE_ONLY_DATE = [
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

describe('série de despesas: promoção (spec 0017, AC-0017-08, INV-0017-05)', () => {
    let ctx: TestApp;
    let fixture: Fixture;
    let service: ExpenseRecurrenceService;

    const atDate = async <T>(iso: string, run: () => Promise<T>): Promise<T> => {
        jest.useFakeTimers({
            now: new Date(`${iso}T15:00:00.000Z`),
            doNotFake: [...FAKE_ONLY_DATE],
        });

        try {
            return await run();
        } finally {
            jest.useRealTimers();
        }
    };

    const promoteAt = (iso: string): Promise<number> =>
        atDate(iso, () => service.promote(new Date(`${iso}T15:00:00Z`)));

    const createFixed = async (overrides: Record<string, unknown> = {}): Promise<void> => {
        const res = await atDate('2026-03-10', () =>
            request(ctx.app)
                .post('/expenses')
                .set('Authorization', ADMIN)
                .send({
                    description: 'Aluguel',
                    expenseTypeId: fixture.typeId,
                    kind: 'FIXED',
                    amountCents: 10000,
                    occurredOn: '2026-03-10',
                    bankAccountId: fixture.accountId,
                    ...overrides,
                }),
        );

        expect(res.status).toBe(201);
    };

    const statuses = async (): Promise<Record<string, string>> =>
        Object.fromEntries(
            (
                (await ctx.dataSource.query(
                    'SELECT occurred_on::text AS d, status FROM expenses ORDER BY occurred_on',
                )) as { d: string; status: string }[]
            ).map((row) => [row.d, row.status]),
        );

    const limit = async (): Promise<number> =>
        (await request(ctx.app).get(`/credit-cards/${fixture.cardId}`).set('Authorization', ADMIN))
            .body.data.availableLimitCents as number;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        service = container.resolve<ExpenseRecurrenceService>(ExpenseRecurrenceServiceSymbol);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        fixture = await seedFixture(ctx);
        await ctx.dataSource.query(
            "UPDATE credit_cards SET created_at = '2026-01-15T12:00:00Z' WHERE id = $1",
            [fixture.cardId],
        );
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await ctx.dataSource.query('DELETE FROM expenses');
        await ctx.dataSource.query('DELETE FROM expense_recurrences');
        await cleanFixture(ctx);
    });

    it('AC-0017-08: promove a OPEN as FORECAST de série com occurredOn <= asOf, e só elas', async () => {
        await createFixed({ status: 'FORECAST' });
        await insertExpense(ctx, {
            typeId: fixture.typeId,
            accountId: fixture.accountId,
            status: 'FORECAST',
            occurredOn: '2026-03-01',
        });

        expect(await promoteAt('2026-05-10')).toBe(3);

        const state = await statuses();

        expect(state['2026-03-01']).toBe('FORECAST');
        expect(state['2026-03-10']).toBe('OPEN');
        expect(state['2026-04-10']).toBe('OPEN');
        expect(state['2026-05-10']).toBe('OPEN');
        expect(state['2026-06-10']).toBe('FORECAST');
        expect(await promoteAt('2026-05-10')).toBe(0);
    });

    it('AC-0017-08, INV-0017-05: a de cartão consome o limite na promoção e a janela fechada barra a promoção', async () => {
        await createFixed({
            status: 'FORECAST',
            bankAccountId: undefined,
            creditCardId: fixture.cardId,
        });

        expect(await limit()).toBe(50000);
        // Em 10/04 a janela até 28/03 está fechada: a de março (postedOn 10/03) fica FORECAST.
        expect(await promoteAt('2026-04-10')).toBe(1);
        expect(await limit()).toBe(40000);
        expect((await statuses())['2026-03-10']).toBe('FORECAST');
        expect((await statuses())['2026-04-10']).toBe('OPEN');
    });

    it('INV-0017-05: a ocorrência gerada nasce FORECAST e a OPEN do usuário não é tocada', async () => {
        await createFixed();

        const state = await statuses();

        expect(state['2026-03-10']).toBe('OPEN');
        expect(state['2026-04-10']).toBe('FORECAST');
        expect(await promoteAt('2026-03-10')).toBe(0);
    });

    it('janela fechada: a ocorrência barrada fica FORECAST e as demais seguem; outro erro propaga', async () => {
        await createFixed({ status: 'FORECAST' });

        const expenses = container.resolve<ExpenseService>(ExpenseServiceSymbol);
        const real = expenses.changeStatus.bind(expenses);
        const spy = jest.spyOn(expenses, 'changeStatus');

        spy.mockImplementationOnce(() =>
            Promise.reject(new CustomError(409, 'STATEMENT_CLOSED', 'closed')),
        );

        expect(await promoteAt('2026-04-10')).toBe(1);
        expect((await statuses())['2026-03-10']).toBe('FORECAST');

        spy.mockImplementation(real);
        spy.mockImplementationOnce(() => Promise.reject(new Error('boom')));

        await expect(promoteAt('2026-04-10')).rejects.toThrow('boom');
    });
});
