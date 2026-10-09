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

const SCHEMA = 'test_statements_payment';

const at = (iso: string): Date => new Date(`${iso}T15:00:00.000Z`);

/** Opening balance of the fixture account and the available limit this suite starts from. */
const INITIAL_BALANCE = 100000;
const INITIAL_LIMIT = 40000;

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

describe('pagamento de fatura fechada (spec 0013, Pagamento)', () => {
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

    const expense = (postedOn: string, amountCents: number, status = 'OPEN'): Promise<string> =>
        insertExpense(ctx, {
            typeId: fx.typeId,
            cardId: fx.cardId,
            occurredOn: postedOn,
            amountCents,
            status,
        });

    const expenseRow = async (id: string): Promise<Row> =>
        (
            (await ctx.dataSource.query(
                "SELECT status, to_char(paid_on, 'YYYY-MM-DD') AS paid_on FROM expenses WHERE id = $1",
                [id],
            )) as [Row]
        )[0];

    const statementId = async (closesOn: string): Promise<string> => {
        const res = await request(ctx.app)
            .get(`/statements?creditCardId=${fx.cardId}&from=${closesOn}&to=${closesOn}`)
            .set('Authorization', ADMIN);

        return (res.body.data as { id: string | null; closesOn: string }[]).find(
            (statement) => statement.closesOn === closesOn,
        )!.id!;
    };

    const pay = (id: string, body: Record<string, unknown>, auth = ADMIN) =>
        request(ctx.app)
            .post(`/statements/${id}/payments`)
            .set('Authorization', auth)
            .send({ bankAccountId: fx.accountId, ...body });

    const undo = (id: string, paymentId: string, auth = ADMIN) =>
        request(ctx.app)
            .delete(`/statements/${id}/payments/${paymentId}`)
            .set('Authorization', auth);

    const get = (id: string) =>
        request(ctx.app).get(`/statements/${id}`).set('Authorization', ADMIN);

    const paymentCount = async (): Promise<number> =>
        (
            (await ctx.dataSource.query(
                'SELECT count(*)::int AS n FROM credit_card_statement_payments',
            )) as [{ n: number }]
        )[0].n;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        fx = await seedFixture(ctx);

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

    beforeEach(async () => {
        await ctx.dataSource.query(
            'UPDATE credit_cards SET available_limit_cents = 400, archived_at = NULL',
        );
        jest.setSystemTime(at('2026-02-11'));
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

    it('AC-0013-13, INV-0013-06: pagar o total debita a conta, libera o limite, quita a cadeia e publica os dois eventos', async () => {
        const open = await expense('2026-02-03', 1000);
        const verifying = await expense('2026-02-04', 500, 'VERIFYING');
        const forecast = await expense('2026-02-05', 300, 'FORECAST');
        const id = await statementId('2026-02-10');

        const res = await pay(id, { amountCents: 1500, paidOn: '2026-02-11' });

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({
            id,
            status: 'PAID',
            totalCents: 1500,
            paidCents: 1500,
            remainingCents: 0,
        });
        expect(await balance()).toBe(INITIAL_BALANCE - 1500);
        expect(await limit()).toBe(INITIAL_LIMIT + 1500);
        expect(await expenseRow(open)).toEqual({ status: 'PAID', paid_on: '2026-02-11' });
        expect(await expenseRow(verifying)).toEqual({ status: 'PAID', paid_on: '2026-02-11' });
        expect((await expenseRow(forecast)).status).toBe('FORECAST');
        expect(registered).toHaveLength(1);
        expect(registered[0]!.payload).toMatchObject({
            statementId: id,
            creditCardId: fx.cardId,
            bankAccountId: fx.accountId,
            amountCents: 1500,
            paidOn: '2026-02-11',
            remainingCents: 0,
        });
        expect(paid.map((event) => event.payload)).toEqual([
            { statementId: id, creditCardId: fx.cardId, paidOn: '2026-02-11' },
        ]);
    });

    it('AC-0013-14, ERR-0013-03, ERR-0013-04: pagar 400 de 1500 não quita; passar do restante é 409; quitar o resto paga as despesas', async () => {
        const first = await expense('2026-02-03', 1500);
        const id = await statementId('2026-02-10');

        const partial = await pay(id, { amountCents: 400 });

        expect(partial.status).toBe(201);
        expect(partial.body.data).toMatchObject({
            status: 'CLOSED',
            paidCents: 400,
            remainingCents: 1100,
        });
        expect(await balance()).toBe(INITIAL_BALANCE - 400);
        expect(await limit()).toBe(INITIAL_LIMIT + 400);
        expect((await expenseRow(first)).status).toBe('OPEN');
        expect(paid).toHaveLength(0);
        expect(registered[0]!.payload.remainingCents).toBe(1100);

        const over = await pay(id, { amountCents: 1101 });

        expect(over.status).toBe(409);
        expect(over.body.error.code).toBe('STATEMENT_PAYMENT_EXCEEDS_REMAINING');
        expect(over.body.error.message).toContain('1100');

        expect((await pay(id, { amountCents: 1100 })).status).toBe(201);
        expect((await expenseRow(first)).status).toBe('PAID');

        const again = await pay(id, { amountCents: 1 });

        expect(again.status).toBe(409);
        expect(again.body.error.code).toBe('STATEMENT_ALREADY_PAID');
    });

    it('AC-0013-15, ERR-0013-11: a rolada recusa pagamento e quitar a seguinte paga as despesas das duas janelas', async () => {
        const february = await expense('2026-02-03', 1500);
        const feb = await statementId('2026-02-10');

        expect((await pay(feb, { amountCents: 400 })).status).toBe(201);

        const march = await expense('2026-03-02', 700);

        jest.setSystemTime(at('2026-03-11'));

        const mar = await statementId('2026-03-10');
        const rolled = await pay(feb, { amountCents: 100, paidOn: '2026-03-11' });

        expect(rolled.status).toBe(409);
        expect(rolled.body.error.code).toBe('STATEMENT_ROLLED_OVER');
        expect((await get(mar)).body.data).toMatchObject({
            previousBalanceCents: 1100,
            amountDueCents: 1800,
        });

        const res = await pay(mar, { amountCents: 1800, paidOn: '2026-03-11' });

        expect(res.status).toBe(201);
        expect(res.body.data.status).toBe('PAID');
        expect(await expenseRow(february)).toEqual({ status: 'PAID', paid_on: '2026-03-11' });
        expect(await expenseRow(march)).toEqual({ status: 'PAID', paid_on: '2026-03-11' });
    });

    it('AC-0013-18: conta inexistente, falha no meio, e nada muda nem publica', async () => {
        const expenseId = await expense('2026-02-03', 1500);
        const id = await statementId('2026-02-10');

        const res = await pay(id, { amountCents: 1500, bankAccountId: randomUUID() });

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
        expect(await paymentCount()).toBe(0);
        expect(await balance()).toBe(INITIAL_BALANCE);
        expect(await limit()).toBe(INITIAL_LIMIT);
        expect((await expenseRow(expenseId)).status).toBe('OPEN');
        expect((await get(id)).body.data.status).toBe('CLOSED');
        expect(registered).toHaveLength(0);
        expect(paid).toHaveLength(0);
    });

    it('AC-0013-20, ERR-0013-06: conta arquivada é 409 BANK_ACCOUNT_ARCHIVED', async () => {
        await expense('2026-02-03', 1500);

        const id = await statementId('2026-02-10');

        await ctx.dataSource.query('UPDATE bank_accounts SET archived_at = now()');

        const res = await pay(id, { amountCents: 100 });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('BANK_ACCOUNT_ARCHIVED');
        expect(await paymentCount()).toBe(0);
    });

    it('AC-0013-20, ERR-0013-07: paidOn igual ao closesOn ou amanhã é 400 e saldo insuficiente é aceito', async () => {
        await expense('2026-02-03', 1500);

        const id = await statementId('2026-02-10');

        for (const paidOn of ['2026-02-10', '2026-02-12']) {
            const res = await pay(id, { amountCents: 100, paidOn });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        }

        await ctx.dataSource.query('UPDATE bank_accounts SET current_balance_cents = 0.10');

        const ok = await pay(id, { amountCents: 100 });

        expect(ok.status).toBe(201);
        expect(await balance()).toBe(-90);
    });

    it('ERR-0013-15: amountCents não positivo, fracionário ou conta ausente é 400', async () => {
        await expense('2026-02-03', 1500);

        const id = await statementId('2026-02-10');

        for (const amountCents of [0, -5, 10.5]) {
            expect((await pay(id, { amountCents })).status).toBe(400);
        }

        const noAccount = await request(ctx.app)
            .post(`/statements/${id}/payments`)
            .set('Authorization', ADMIN)
            .send({ amountCents: 100 });

        expect(noAccount.status).toBe(400);
        expect(noAccount.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('ERR-0013-01: fatura ou pagamento inexistente é 404', async () => {
        await expense('2026-02-03', 1500);

        const id = await statementId('2026-02-10');
        const missing = await pay(randomUUID(), { amountCents: 100 });

        expect(missing.status).toBe(404);
        expect(missing.body.error.code).toBe('STATEMENT_NOT_FOUND');

        const gone = await undo(id, randomUUID());

        expect(gone.status).toBe(404);
        expect(gone.body.error.code).toBe('STATEMENT_PAYMENT_NOT_FOUND');
    });

    it('AC-0013-19: desfazer o último pagamento da fatura quitada reverte conta, limite, status e despesas', async () => {
        const expenseId = await expense('2026-02-03', 1500);
        const id = await statementId('2026-02-10');
        const paymentId = (await pay(id, { amountCents: 1500 })).body.data.payments[0].id as string;

        const res = await undo(id, paymentId);

        expect(res.status).toBe(204);
        expect(await balance()).toBe(INITIAL_BALANCE);
        expect(await limit()).toBe(INITIAL_LIMIT);
        expect(await expenseRow(expenseId)).toEqual({ status: 'OPEN', paid_on: null });
        expect((await get(id)).body.data).toMatchObject({
            status: 'CLOSED',
            paidCents: 0,
            remainingCents: 1500,
        });
        expect(registered).toHaveLength(1);
        expect(paid).toHaveLength(1);
    });

    it('AC-0013-19, ERR-0013-12: só o último pagamento se desfaz, e nunca depois de a seguinte ser registrada', async () => {
        await expense('2026-02-03', 1500);

        const id = await statementId('2026-02-10');

        await pay(id, { amountCents: 300, paidOn: '2026-02-11' });

        const payments = (await pay(id, { amountCents: 200, paidOn: '2026-02-11' })).body.data
            .payments as { id: string }[];
        const notLast = await undo(id, payments[0]!.id);

        expect(notLast.status).toBe(409);
        expect(notLast.body.error.code).toBe('STATEMENT_PAYMENT_LOCKED');

        jest.setSystemTime(at('2026-03-11'));

        const afterNext = await undo(id, payments[1]!.id);

        expect(afterNext.status).toBe(409);
        expect(afterNext.body.error.code).toBe('STATEMENT_PAYMENT_LOCKED');
        expect(await paymentCount()).toBe(2);
        expect(await balance()).toBe(INITIAL_BALANCE - 500);
    });

    it('AC-0013-17, ERR-0013-15: PATCH grava o mínimo, aceita null e zero, e recusa negativo e outros campos', async () => {
        await expense('2026-02-03', 1500);

        const id = await statementId('2026-02-10');
        const patch = (body: Record<string, unknown>) =>
            request(ctx.app).patch(`/statements/${id}`).set('Authorization', ADMIN).send(body);

        const set = await patch({ minimumPaymentCents: 99999 });

        expect(set.status).toBe(200);
        expect(set.body.data.minimumPaymentCents).toBe(99999);
        expect((await patch({ minimumPaymentCents: 0 })).body.data.minimumPaymentCents).toBe(0);
        expect(
            (await patch({ minimumPaymentCents: null })).body.data.minimumPaymentCents,
        ).toBeNull();
        expect((await patch({ minimumPaymentCents: -1 })).status).toBe(400);
        expect((await patch({ minimumPaymentCents: 1.5 })).status).toBe(400);
        expect((await patch({ minimumPaymentCents: 10, status: 'PAID' })).status).toBe(400);

        const missing = await request(ctx.app)
            .patch(`/statements/${randomUUID()}`)
            .set('Authorization', ADMIN)
            .send({ minimumPaymentCents: 1 });

        expect(missing.status).toBe(404);
    });

    it('INV-0013-13: VIEWER recebe 403 FORBIDDEN em pagar, desfazer e informar mínimo; BILLER paga', async () => {
        await expense('2026-02-03', 1500);

        const id = await statementId('2026-02-10');
        const viewer = 'Bearer uid-viewer-payment';
        const biller = 'Bearer uid-biller-payment';

        for (const [token, profile] of [
            [viewer, 'VIEWER'],
            [biller, 'BILLER'],
        ] as const) {
            await request(ctx.app).get('/users/me').set('Authorization', token);
            await ctx.setProfile(token.replace('Bearer ', ''), profile);
        }

        const writes = [
            await pay(id, { amountCents: 100 }, viewer),
            await undo(id, randomUUID(), viewer),
            await request(ctx.app)
                .patch(`/statements/${id}`)
                .set('Authorization', viewer)
                .send({ minimumPaymentCents: 1 }),
        ];

        for (const res of writes) {
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('FORBIDDEN');
        }

        expect(await paymentCount()).toBe(0);
        expect((await pay(id, { amountCents: 100 }, biller)).status).toBe(201);
    });
});
