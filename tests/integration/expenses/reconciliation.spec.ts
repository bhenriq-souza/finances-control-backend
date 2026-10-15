import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../app.helper';
import { ADMIN, cleanFixture, insertExpense, seedFixture, type Fixture } from './fixture.helper';

const SCHEMA = 'test_expenses_reconciliation';

/** "Today" is 2026-03-20: the card (closing day 10) has the cycle ending 2026-03-10 closed. */
const NOW = new Date('2026-03-20T15:00:00.000Z');
const INITIAL_LIMIT = 50000;

describe('conferência: despesa incluída na fatura do banco (spec 0020)', () => {
    let ctx: TestApp;
    let fx: Fixture;

    const reconcile = (id: string, body: unknown, auth = ADMIN) =>
        request(ctx.app)
            .patch(`/expenses/${id}/reconciliation`)
            .set('Authorization', auth)
            .send(body as object);

    const onCard = (overrides: Record<string, unknown> = {}): Promise<string> =>
        insertExpense(ctx, {
            typeId: fx.typeId,
            cardId: fx.cardId,
            occurredOn: '2026-03-15',
            amountCents: 1000,
            ...overrides,
        });

    const row = async (id: string) =>
        (
            (await ctx.dataSource.query(
                `SELECT status, credit_card_id AS "creditCardId", reconciled_at AS "reconciledAt"
                 FROM expenses WHERE id = $1`,
                [id],
            )) as { status: string; creditCardId: string | null; reconciledAt: Date | null }[]
        )[0]!;

    const limit = async (cardId = fx.cardId): Promise<number> =>
        Math.round(
            Number(
                (
                    (await ctx.dataSource.query(
                        'SELECT available_limit_cents AS v FROM credit_cards WHERE id = $1',
                        [cardId],
                    )) as [{ v: string }]
                )[0].v,
            ) * 100,
        );

    const statementTotal = async (): Promise<number> =>
        (
            await request(ctx.app)
                .get(`/statements/current?creditCardId=${fx.cardId}`)
                .set('Authorization', ADMIN)
        ).body.data.totalCents as number;

    const as = async (profile: 'BILLER' | 'VIEWER'): Promise<string> => {
        const uid = `uid-${profile.toLowerCase()}-reconcile`;
        await request(ctx.app).get('/users/me').set('Authorization', `Bearer ${uid}`);
        await ctx.setProfile(uid, profile);

        return `Bearer ${uid}`;
    };

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        fx = await seedFixture(ctx);

        await ctx.dataSource.query(
            "UPDATE credit_cards SET closing_day = 10, due_day = 20, created_at = '2026-01-15T12:00:00Z'",
        );

        // Only `Date` is faked: sockets, timers and the event loop stay real.
        jest.useFakeTimers({
            now: NOW,
            doNotFake: [
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
            ],
        });
    });

    afterAll(async () => {
        jest.useRealTimers();
        await ctx.dataSource.query("DELETE FROM credit_cards WHERE name = 'Outro'");
        await cleanFixture(ctx);
        await stopApp(ctx, SCHEMA);
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM expenses');
        await ctx.dataSource.query('DELETE FROM credit_card_statements');
        await ctx.dataSource.query(
            `UPDATE credit_cards SET available_limit_cents = ${INITIAL_LIMIT / 100}`,
        );
    });

    it('AC-0020-01, INV-0020-02: marcar uma OPEN grava reconciledAt e não move status, limite nem total', async () => {
        const id = await onCard();
        const limitBefore = await limit();
        const totalBefore = await statementTotal();

        const res = await reconcile(id, { reconciled: true });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ id, status: 'OPEN' });
        expect(new Date(res.body.data.reconciledAt as string).toISOString()).toBe(
            NOW.toISOString(),
        );
        expect(await limit()).toBe(limitBefore);
        expect(await statementTotal()).toBe(totalBefore);
    });

    it.each(['VERIFYING', 'PAID'])('AC-0020-01: uma %s também é marcada', async (status) => {
        const id = await onCard({ status });

        const res = await reconcile(id, { reconciled: true });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe(status);
        expect(res.body.data.reconciledAt).not.toBeNull();
    });

    it('AC-0020-02: marcar de novo mantém a data; desmarcar limpa; desmarcar de novo não faz nada', async () => {
        const id = await onCard();
        await ctx.dataSource.query(
            "UPDATE expenses SET reconciled_at = '2026-03-16T10:00:00Z' WHERE id = $1",
            [id],
        );

        const again = await reconcile(id, { reconciled: true });
        expect(again.status).toBe(200);
        expect(again.body.data.reconciledAt).toBe('2026-03-16T10:00:00.000Z');

        const off = await reconcile(id, { reconciled: false });
        expect(off.status).toBe(200);
        expect(off.body.data.reconciledAt).toBeNull();

        const offAgain = await reconcile(id, { reconciled: false });
        expect(offAgain.status).toBe(200);
        expect(offAgain.body.data.reconciledAt).toBeNull();
    });

    it('AC-0020-03, INV-0020-02: marcar uma FORECAST a confirma e abate o limite; desmarcar a mantém OPEN', async () => {
        const id = await onCard({ status: 'FORECAST', amountCents: 1490 });
        const limitBefore = await limit();

        const on = await reconcile(id, { reconciled: true });

        expect(on.status).toBe(200);
        expect(on.body.data.status).toBe('OPEN');
        expect(on.body.data.reconciledAt).not.toBeNull();
        expect(await limit()).toBe(limitBefore - 1490);

        const off = await reconcile(id, { reconciled: false });

        expect(off.body.data).toMatchObject({ status: 'OPEN', reconciledAt: null });
        expect(await limit()).toBe(limitBefore - 1490);
    });

    it('desmarcar uma FORECAST responde 200 sem efeito', async () => {
        const id = await onCard({ status: 'FORECAST' });

        const res = await reconcile(id, { reconciled: false });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: 'FORECAST', reconciledAt: null });
    });

    it('AC-0020-04, ERR-0020-04: marcar uma FORECAST da janela fechada é 409 STATEMENT_CLOSED e nada muda', async () => {
        const id = await onCard({ status: 'FORECAST', occurredOn: '2026-03-05' });
        const limitBefore = await limit();

        const res = await reconcile(id, { reconciled: true });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('STATEMENT_CLOSED');
        expect(await row(id)).toMatchObject({ status: 'FORECAST', reconciledAt: null });
        expect(await limit()).toBe(limitBefore);
    });

    it('a janela fechada aceita marcar uma OPEN: o total não muda', async () => {
        const id = await onCard({ occurredOn: '2026-03-05' });

        const res = await reconcile(id, { reconciled: true });

        expect(res.status).toBe(200);
        expect(res.body.data.reconciledAt).not.toBeNull();
    });

    it('AC-0020-05, ERR-0020-01: despesa de conta é 409 EXPENSE_NOT_ON_CREDIT_CARD', async () => {
        const id = await insertExpense(ctx, { typeId: fx.typeId, accountId: fx.accountId });

        const res = await reconcile(id, { reconciled: true });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('EXPENSE_NOT_ON_CREDIT_CARD');
        expect((await row(id)).reconciledAt).toBeNull();
    });

    it('AC-0020-05, ERR-0020-03: id inexistente é 404 EXPENSE_NOT_FOUND', async () => {
        const res = await reconcile(randomUUID(), { reconciled: true });

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('EXPENSE_NOT_FOUND');
    });

    it.each([[{}], [{ reconciled: 'yes' }], [{ reconciled: true, status: 'OPEN' }]])(
        'AC-0020-05, ERR-0020-02: corpo %j é 400 VALIDATION_ERROR',
        async (body) => {
            const id = await onCard();

            const res = await reconcile(id, body);

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect((await row(id)).reconciledAt).toBeNull();
        },
    );

    it('AC-0020-06, ERR-0020-05: VIEWER recebe 403; BILLER confere', async () => {
        const id = await onCard();

        const viewer = await reconcile(id, { reconciled: true }, await as('VIEWER'));
        expect(viewer.status).toBe(403);
        expect(viewer.body.error.code).toBe('FORBIDDEN');
        expect((await row(id)).reconciledAt).toBeNull();

        const biller = await reconcile(id, { reconciled: true }, await as('BILLER'));
        expect(biller.status).toBe(200);
        expect(biller.body.data.reconciledAt).not.toBeNull();
    });

    it('AC-0020-07, INV-0020-01: o banco recusa a marca em despesa de conta e em FORECAST', async () => {
        const account = await insertExpense(ctx, { typeId: fx.typeId, accountId: fx.accountId });
        const forecast = await onCard({ status: 'FORECAST' });
        const marked = await onCard();
        await reconcile(marked, { reconciled: true });

        await expect(
            ctx.dataSource.query('UPDATE expenses SET reconciled_at = now() WHERE id = $1', [
                account,
            ]),
        ).rejects.toThrow(/ck_expenses_reconciled_at/);
        await expect(
            ctx.dataSource.query('UPDATE expenses SET reconciled_at = now() WHERE id = $1', [
                forecast,
            ]),
        ).rejects.toThrow(/ck_expenses_reconciled_at/);
        await expect(
            ctx.dataSource.query("UPDATE expenses SET status = 'FORECAST' WHERE id = $1", [marked]),
        ).rejects.toThrow(/ck_expenses_reconciled_at/);
    });

    it('AC-0020-08: sair do cartão, para uma conta ou outro cartão, tira a marca', async () => {
        const bankId = (
            (await ctx.dataSource.query('SELECT bank_id AS id FROM credit_cards LIMIT 1')) as [
                { id: string },
            ]
        )[0].id;
        const other = (
            await request(ctx.app).post('/credit-cards').set('Authorization', ADMIN).send({
                bankId,
                name: 'Outro',
                creditLimitCents: 50000,
                closingDay: 28,
                dueDay: 5,
            })
        ).body.data.id as string;
        const toAccount = await onCard();
        const toOtherCard = await onCard();
        await reconcile(toAccount, { reconciled: true });
        await reconcile(toOtherCard, { reconciled: true });

        const moved = await request(ctx.app)
            .patch(`/expenses/${toAccount}/payment-method`)
            .set('Authorization', ADMIN)
            .send({ bankAccountId: fx.accountId });
        const switched = await request(ctx.app)
            .patch(`/expenses/${toOtherCard}/payment-method`)
            .set('Authorization', ADMIN)
            .send({ creditCardId: other });

        expect(moved.status).toBe(200);
        expect(moved.body.data[0].reconciledAt).toBeNull();
        expect(switched.status).toBe(200);
        expect(switched.body.data[0]).toMatchObject({ creditCardId: other, reconciledAt: null });
    });

    it('AC-0020-08: alterar o valor preserva a marca', async () => {
        const id = await onCard();
        const marked = (await reconcile(id, { reconciled: true })).body.data.reconciledAt as string;

        const res = await request(ctx.app)
            .patch(`/expenses/${id}`)
            .set('Authorization', ADMIN)
            .send({ amountCents: 1234 });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ amountCents: 1234, reconciledAt: marked });
    });

    it('ExpenseResponse traz reconciledAt nulo em despesa de conta', async () => {
        const id = await insertExpense(ctx, { typeId: fx.typeId, accountId: fx.accountId });

        const res = await request(ctx.app).get(`/expenses/${id}`).set('Authorization', ADMIN);

        expect(res.body.data.reconciledAt).toBeNull();
    });
});
