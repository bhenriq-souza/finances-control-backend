import request from 'supertest';

import { DEFAULT_WORKSPACE_SQL, startApp, stopApp, type TestApp } from '../app.helper';
import { ADMIN, seedFixture, type Fixture } from '../expenses/fixture.helper';

const SCHEMA = 'test_statements_reconciliation';

/** 2026-04-15 in business time: with a card closing on 10, the open statement is 04/11 to 05/10. */
const NOW = new Date('2026-04-15T15:00:00.000Z');

/** Only `Date` is faked: sockets, timers and the event loop stay real. */
const FAKE_DATE_ONLY = [
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

type StatementBody = {
    id: string | null;
    closesOn: string;
    totalCents: number;
    reconciledCents: number;
    pendingReconciliationCents: number;
    expenses?: { id: string; reconciledAt: string | null }[];
};

describe('conferência: conferido e pendente da fatura (spec 0020)', () => {
    let ctx: TestApp;
    let fx: Fixture;

    const get = (path: string) => request(ctx.app).get(path).set('Authorization', ADMIN);

    const addExpense = async (
        cents: number,
        postedOn: string,
        options: { status?: string; reconciled?: boolean } = {},
    ): Promise<string> => {
        const status = options.status ?? 'OPEN';
        const rows = (await ctx.dataSource.query(
            `INSERT INTO expenses (workspace_id, description, expense_type_id, kind, status, amount_cents,
                occurred_on, credit_card_id, posted_on, reconciled_at)
             VALUES (${DEFAULT_WORKSPACE_SQL}, 'Compra', $1, 'VARIABLE', $2, $3, $4::date, $5, $4::date, $6)
             RETURNING id`,
            [
                fx.typeId,
                status,
                cents / 100,
                postedOn,
                fx.cardId,
                options.reconciled ? '2026-04-14T12:00:00Z' : null,
            ],
        )) as { id: string }[];

        return rows[0]!.id;
    };

    const addRefund = (cents: number, postedOn: string) =>
        ctx.dataSource.query(
            `INSERT INTO credit_card_refunds (workspace_id, credit_card_id, description, amount_cents, occurred_on, posted_on)
             VALUES (${DEFAULT_WORKSPACE_SQL}, $1, 'Estorno', $2, $3::date, $3::date)`,
            [fx.cardId, cents / 100, postedOn],
        );

    const holds = (statement: StatementBody): boolean =>
        statement.reconciledCents + statement.pendingReconciliationCents === statement.totalCents;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        fx = await seedFixture(ctx);
        await ctx.dataSource.query(
            "UPDATE credit_cards SET closing_day = 10, due_day = 20, created_at = '2026-01-15T12:00:00Z'",
        );
        jest.useFakeTimers({ now: NOW, doNotFake: [...FAKE_DATE_ONLY] });
    });

    afterAll(async () => {
        jest.useRealTimers();
        await stopApp(ctx, SCHEMA);
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM credit_card_refunds');
        await ctx.dataSource.query('DELETE FROM credit_card_statements');
        await ctx.dataSource.query('DELETE FROM expenses');
    });

    it('AC-0020-09, INV-0020-03, INV-0020-04: a fatura aberta separa conferido e pendente; FORECAST fica fora e o estorno conta como conferido', async () => {
        const marked = await addExpense(10000, '2026-04-20', { reconciled: true });
        const unmarked = await addExpense(5000, '2026-04-21');
        await addExpense(3000, '2026-04-22', { status: 'FORECAST' });
        await addRefund(2000, '2026-04-23');

        const res = await get(`/statements/current?creditCardId=${fx.cardId}`);
        const statement = res.body.data as StatementBody;

        expect(res.status).toBe(200);
        expect(statement).toMatchObject({
            totalCents: 13000,
            reconciledCents: 8000,
            pendingReconciliationCents: 5000,
        });
        expect(holds(statement)).toBe(true);
        expect(statement.expenses).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: marked, reconciledAt: '2026-04-14T12:00:00.000Z' }),
                expect.objectContaining({ id: unmarked, reconciledAt: null }),
            ]),
        );
    });

    it('AC-0020-09: sem nada marcado, o conferido é só o crédito dos estornos', async () => {
        await addExpense(5000, '2026-04-20');
        await addRefund(7000, '2026-04-21');

        const statement = (await get(`/statements/current?creditCardId=${fx.cardId}`)).body
            .data as StatementBody;

        expect(statement).toMatchObject({
            totalCents: -2000,
            reconciledCents: -7000,
            pendingReconciliationCents: 5000,
        });
    });

    it('AC-0020-10, INV-0020-03: a listagem e a fatura fechada trazem os dois valores', async () => {
        await addExpense(4000, '2026-03-20', { reconciled: true });
        await addExpense(1000, '2026-03-21');
        await addExpense(2500, '2026-04-20');
        await addExpense(600, '2026-05-20', { reconciled: true });

        const listing = (await get(`/statements?creditCardId=${fx.cardId}`)).body
            .data as StatementBody[];

        expect(listing.length).toBeGreaterThan(1);
        for (const statement of listing) {
            expect(holds(statement)).toBe(true);
        }
        expect(listing.find((s) => s.closesOn === '2026-04-10')).toMatchObject({
            totalCents: 5000,
            reconciledCents: 4000,
            pendingReconciliationCents: 1000,
        });

        const projected = (
            await get(`/statements?creditCardId=${fx.cardId}&from=2026-06-10&to=2026-06-10`)
        ).body.data as StatementBody[];
        expect(projected[0]).toMatchObject({
            id: null,
            reconciledCents: 600,
            pendingReconciliationCents: 0,
        });

        const closedId = listing.find((s) => s.closesOn === '2026-04-10')!.id!;
        const closed = (await get(`/statements/${closedId}`)).body.data as StatementBody;

        expect(closed).toMatchObject({ reconciledCents: 4000, pendingReconciliationCents: 1000 });
        expect(holds(closed)).toBe(true);
    });
});
