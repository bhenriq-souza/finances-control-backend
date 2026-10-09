import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { container } from '../../../src/container';
import {
    STATEMENT_PAID,
    STATEMENT_PAYMENT_REGISTERED,
    type StatementPaid,
    type StatementPaymentRegistered,
} from '../../../src/events';
import { DomainEventDispatcherSymbol, type DomainEventDispatcher } from '../../../src/platform';
import { startApp, stopApp, type TestApp } from '../app.helper';
import {
    ADMIN,
    cleanFixture,
    insertExpense,
    seedFixture,
    type Fixture,
} from '../expenses/fixture.helper';

const SCHEMA = 'test_statements_advance_payment';

const at = (iso: string): Date => new Date(`${iso}T15:00:00.000Z`);

const INITIAL_BALANCE = 100000;
const INITIAL_LIMIT = 40000;

/** Only `Date` is faked: sockets, timers and the event loop stay real. */
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

type Row = { status: string; paid_on: string | null };

/** "Today" is 2026-03-20: the open cycle is 2026-03-11 to 2026-04-10 (closing day 10). */
describe('pagamento antecipado da fatura aberta (spec 0013, Pagamento antecipado)', () => {
    let ctx: TestApp;
    let fx: Fixture;
    let registered: StatementPaymentRegistered[];
    let paid: StatementPaid[];
    let unsubscribe: () => void;

    const cents = (column: string, table: string, id: string) => async (): Promise<number> =>
        Math.round(
            Number(
                (
                    (await ctx.dataSource.query(
                        `SELECT ${column} AS v FROM ${table} WHERE id = $1`,
                        [id],
                    )) as [{ v: string }]
                )[0].v,
            ) * 100,
        );

    const balance = (): Promise<number> =>
        cents('current_balance_cents', 'bank_accounts', fx.accountId)();
    const limit = (): Promise<number> =>
        cents('available_limit_cents', 'credit_cards', fx.cardId)();

    const expense = (postedOn: string, amountCents: number): Promise<string> =>
        insertExpense(ctx, {
            typeId: fx.typeId,
            cardId: fx.cardId,
            occurredOn: postedOn,
            amountCents,
        });

    const expenseRow = async (id: string): Promise<Row> =>
        (
            (await ctx.dataSource.query(
                "SELECT status, to_char(paid_on, 'YYYY-MM-DD') AS paid_on FROM expenses WHERE id = $1",
                [id],
            )) as [Row]
        )[0];

    const early = (body: Record<string, unknown>, auth = ADMIN) =>
        request(ctx.app)
            .post('/statements/current/payments')
            .set('Authorization', auth)
            .send({ creditCardId: fx.cardId, bankAccountId: fx.accountId, ...body });

    const undoEarly = (paymentId: string, auth = ADMIN) =>
        request(ctx.app)
            .delete(`/statements/current/payments/${paymentId}?creditCardId=${fx.cardId}`)
            .set('Authorization', auth);

    const current = () =>
        request(ctx.app)
            .get(`/statements/current?creditCardId=${fx.cardId}`)
            .set('Authorization', ADMIN);

    const statementAt = async (closesOn: string) =>
        (
            (
                await request(ctx.app)
                    .get(`/statements?creditCardId=${fx.cardId}&from=${closesOn}&to=${closesOn}`)
                    .set('Authorization', ADMIN)
            ).body.data as { id: string; status: string; closesOn: string }[]
        ).find((statement) => statement.closesOn === closesOn)!;

    const rows = async (): Promise<{ statement_id: string | null }[]> =>
        (await ctx.dataSource.query('SELECT statement_id FROM credit_card_statement_payments')) as {
            statement_id: string | null;
        }[];

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        fx = await seedFixture(ctx);

        await ctx.dataSource.query(
            "UPDATE credit_cards SET closing_day = 10, due_day = 20, created_at = '2026-01-15T12:00:00Z'",
        );
        jest.useFakeTimers({ now: at('2026-03-20'), doNotFake: [...DATE_ONLY] });
    });

    afterAll(async () => {
        jest.useRealTimers();
        await cleanFixture(ctx);
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        await ctx.dataSource.query(
            'UPDATE credit_cards SET available_limit_cents = 400, archived_at = NULL',
        );
        jest.setSystemTime(at('2026-03-20'));
        registered = [];
        paid = [];

        const dispatcher = container.resolve<DomainEventDispatcher>(DomainEventDispatcherSymbol);
        const offRegistered = dispatcher.subscribe<StatementPaymentRegistered>(
            STATEMENT_PAYMENT_REGISTERED,
            (event) => {
                registered.push(event);

                return Promise.resolve();
            },
        );
        const offPaid = dispatcher.subscribe<StatementPaid>(STATEMENT_PAID, (event) => {
            paid.push(event);

            return Promise.resolve();
        });

        unsubscribe = () => {
            offRegistered();
            offPaid();
        };
    });

    afterEach(async () => {
        unsubscribe();
        await ctx.dataSource.query('DELETE FROM credit_card_statement_payments');
        await ctx.dataSource.query('DELETE FROM credit_card_statements');
        await ctx.dataSource.query('DELETE FROM expenses');
        await ctx.dataSource.query(
            'UPDATE credit_cards SET available_limit_cents = 400, archived_at = NULL',
        );
        await ctx.dataSource.query(
            `UPDATE bank_accounts SET current_balance_cents = ${INITIAL_BALANCE / 100}, archived_at = NULL`,
        );
    });

    it('AC-0013-24, INV-0013-14: o antecipado de 500 move conta e limite, não paga despesa e a fatura nasce CLOSED com ele', async () => {
        const expenseId = await expense('2026-03-15', 1500);

        const res = await early({ amountCents: 500 });

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({
            id: null,
            status: 'OPEN',
            paidCents: 500,
            remainingCents: 1000,
        });
        expect(await balance()).toBe(INITIAL_BALANCE - 500);
        expect(await limit()).toBe(INITIAL_LIMIT + 500);
        expect((await expenseRow(expenseId)).status).toBe('OPEN');
        expect(await rows()).toEqual([{ statement_id: null }]);
        expect(registered.map((event) => event.payload)).toEqual([
            {
                statementId: null,
                paymentId: expect.any(String) as string,
                creditCardId: fx.cardId,
                bankAccountId: fx.accountId,
                amountCents: 500,
                paidOn: '2026-03-20',
                remainingCents: 1000,
            },
        ]);
        expect((await current()).body.data).toMatchObject({ paidCents: 500, remainingCents: 1000 });

        jest.setSystemTime(at('2026-04-11'));

        const closed = await statementAt('2026-04-10');
        const detail = (
            await request(ctx.app).get(`/statements/${closed.id}`).set('Authorization', ADMIN)
        ).body.data;

        expect(closed.status).toBe('CLOSED');
        expect(detail).toMatchObject({ paidCents: 500, remainingCents: 1000 });
        expect(await rows()).toEqual([{ statement_id: closed.id }]);
        expect((await expenseRow(expenseId)).status).toBe('OPEN');
    });

    it('AC-0013-25: o antecipado que cobre a fatura inteira a faz nascer PAID, com despesas PAID e StatementPaid', async () => {
        const expenseId = await expense('2026-03-15', 1500);

        expect((await early({ amountCents: 1500, paidOn: '2026-03-18' })).status).toBe(201);
        expect(paid.filter((event) => event.payload.paidOn === '2026-03-18')).toHaveLength(0);

        jest.setSystemTime(at('2026-04-11'));

        const closed = await statementAt('2026-04-10');

        expect(closed.status).toBe('PAID');
        expect(await expenseRow(expenseId)).toEqual({ status: 'PAID', paid_on: '2026-03-18' });
        expect(
            paid
                .filter((event) => event.payload.statementId === closed.id)
                .map((event) => event.payload),
        ).toEqual([{ statementId: closed.id, creditCardId: fx.cardId, paidOn: '2026-03-18' }]);
    });

    it('AC-0013-25: uma compra de 200 depois do antecipado faz a fatura nascer CLOSED com 200 de restante', async () => {
        await expense('2026-03-15', 1500);
        await early({ amountCents: 1500 });
        await expense('2026-03-25', 200);

        jest.setSystemTime(at('2026-04-11'));

        const closed = await statementAt('2026-04-10');
        const detail = (
            await request(ctx.app).get(`/statements/${closed.id}`).set('Authorization', ADMIN)
        ).body.data;

        expect(closed.status).toBe('CLOSED');
        expect(detail.remainingCents).toBe(200);
        expect(paid.filter((event) => event.payload.statementId === closed.id)).toHaveLength(0);
    });

    it('AC-0013-26, ERR-0013-17: com fatura CLOSED pendente o antecipado é 409 STATEMENT_PREVIOUS_UNPAID citando a pendente', async () => {
        await expense('2026-02-05', 1500);
        await expense('2026-03-15', 700);

        // February rolled into March, which is the one still closed and unpaid.
        const pending = await statementAt('2026-03-10');
        const res = await early({ amountCents: 100 });

        expect(pending.status).toBe('CLOSED');
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('STATEMENT_PREVIOUS_UNPAID');
        expect(res.body.error.message).toContain(pending.id);
        expect(await rows()).toEqual([]);
        expect(await balance()).toBe(INITIAL_BALANCE);
        expect(registered).toHaveLength(0);
    });

    it('AC-0013-26, ERR-0013-04: acima do restante atual é 409 STATEMENT_PAYMENT_EXCEEDS_REMAINING', async () => {
        await expense('2026-03-15', 1500);

        expect((await early({ amountCents: 1000 })).status).toBe(201);

        const res = await early({ amountCents: 501 });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('STATEMENT_PAYMENT_EXCEEDS_REMAINING');
        expect(res.body.error.message).toContain('500');
        expect(await rows()).toHaveLength(1);
    });

    it('ERR-0013-07: paidOn antes do início da fatura aberta ou amanhã é 400', async () => {
        await expense('2026-03-15', 1500);

        for (const paidOn of ['2026-03-10', '2026-03-21']) {
            const res = await early({ amountCents: 100, paidOn });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        }

        expect((await early({ amountCents: 100, paidOn: '2026-03-11' })).status).toBe(201);
    });

    it('ERR-0013-05, ERR-0013-06, ERR-0013-15: cartão ou conta inexistente é 404, conta arquivada 409, valor ou cartão ausente 400', async () => {
        await expense('2026-03-15', 1500);

        const noCard = await early({ amountCents: 100, creditCardId: randomUUID() });
        const noAccount = await early({ amountCents: 100, bankAccountId: randomUUID() });

        expect(noCard.status).toBe(404);
        expect(noCard.body.error.code).toBe('CREDIT_CARD_NOT_FOUND');
        expect(noAccount.status).toBe(404);
        expect(noAccount.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');

        await ctx.dataSource.query('UPDATE bank_accounts SET archived_at = now()');

        const archived = await early({ amountCents: 100 });

        expect(archived.status).toBe(409);
        expect(archived.body.error.code).toBe('BANK_ACCOUNT_ARCHIVED');
        expect((await early({ amountCents: 0 })).status).toBe(400);
        expect(
            (
                await request(ctx.app)
                    .post('/statements/current/payments')
                    .set('Authorization', ADMIN)
                    .send({ bankAccountId: fx.accountId, amountCents: 100 })
            ).status,
        ).toBe(400);
        expect(await rows()).toEqual([]);
    });

    it('AC-0013-26: desfazer o último antecipado devolve a conta, consome o limite e só aceita o último', async () => {
        await expense('2026-03-15', 1500);

        await early({ amountCents: 300 });
        await early({ amountCents: 200 });

        const ids = (await ctx.dataSource.query(
            'SELECT id FROM credit_card_statement_payments ORDER BY paid_on, created_at, id',
        )) as { id: string }[];
        const lastId = (
            (await ctx.dataSource.query(
                'SELECT id FROM credit_card_statement_payments ORDER BY paid_on DESC, created_at DESC, id DESC LIMIT 1',
            )) as { id: string }[]
        )[0]!.id;
        const notLast = ids.find((row) => row.id !== lastId)!.id;
        const lockedRes = await undoEarly(notLast);

        expect(lockedRes.status).toBe(409);
        expect(lockedRes.body.error.code).toBe('STATEMENT_PAYMENT_LOCKED');

        const res = await undoEarly(lastId);

        expect(res.status).toBe(204);
        expect(await balance()).toBe(INITIAL_BALANCE - 300);
        expect(await limit()).toBe(INITIAL_LIMIT + 300);
        expect(await rows()).toHaveLength(1);
        expect(registered).toHaveLength(2);

        const gone = await undoEarly(randomUUID());

        expect(gone.status).toBe(404);
        expect(gone.body.error.code).toBe('STATEMENT_PAYMENT_NOT_FOUND');
    });

    it('INV-0013-13: VIEWER recebe 403 FORBIDDEN no antecipado e ao desfazê-lo', async () => {
        await expense('2026-03-15', 1500);

        const viewer = 'Bearer uid-viewer-advance';

        await request(ctx.app).get('/users/me').set('Authorization', viewer);
        await ctx.setProfile('uid-viewer-advance', 'VIEWER');

        for (const res of [
            await early({ amountCents: 100 }, viewer),
            await undoEarly(randomUUID(), viewer),
        ]) {
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('FORBIDDEN');
        }

        expect(await rows()).toEqual([]);
    });
});
