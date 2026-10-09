import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { container } from '../../../src/container';
import {
    CREDIT_CARD_REFUND_REGISTERED,
    type CreditCardRefundRegistered,
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

const SCHEMA = 'test_statements_refunds';

/** "Today" is 2026-03-20: the card (closing day 10) has the cycle ending 2026-03-10 closed. */
const NOW = new Date('2026-03-20T15:00:00.000Z');
const CLOSED_THROUGH = '2026-03-10';

/** Initial available limit of the fixture card, in cents (credit limit 50000). */
const INITIAL_LIMIT = 50000;

describe('estornos de cartão (spec 0013, Estornos)', () => {
    let ctx: TestApp;
    let fx: Fixture;
    let received: CreditCardRefundRegistered[];
    let unsubscribe: () => void;

    const post = (body: Record<string, unknown>, auth = ADMIN) =>
        request(ctx.app)
            .post('/credit-card-refunds')
            .set('Authorization', auth)
            .send({
                creditCardId: fx.cardId,
                description: 'Estorno',
                amountCents: 30000,
                occurredOn: '2026-03-18',
                ...body,
            });

    const patch = (id: string, body: Record<string, unknown>) =>
        request(ctx.app).patch(`/credit-card-refunds/${id}`).set('Authorization', ADMIN).send(body);

    const remove = (id: string) =>
        request(ctx.app).delete(`/credit-card-refunds/${id}`).set('Authorization', ADMIN);

    const get = (path: string) => request(ctx.app).get(path).set('Authorization', ADMIN);

    const availableLimit = async (): Promise<number> =>
        Math.round(
            Number(
                (
                    (await ctx.dataSource.query(
                        'SELECT available_limit_cents AS v FROM credit_cards WHERE id = $1',
                        [fx.cardId],
                    )) as [{ v: string }]
                )[0].v,
            ) * 100,
        );

    const refundCount = async (): Promise<number> =>
        (
            (await ctx.dataSource.query('SELECT count(*)::int AS n FROM credit_card_refunds')) as [
                { n: number },
            ]
        )[0].n;

    /** A refund already inside the closed window (posted 2026-03-05), inserted straight in the table. */
    const closedRefund = async (): Promise<string> =>
        (
            (await ctx.dataSource.query(
                `INSERT INTO credit_card_refunds
                    (credit_card_id, description, amount_cents, occurred_on, posted_on)
                 VALUES ($1, 'Antigo', 50.00, '2026-03-05', '2026-03-05') RETURNING id`,
                [fx.cardId],
            )) as [{ id: string }]
        )[0].id;

    const cardExpense = (amountCents = 40000): Promise<string> =>
        insertExpense(ctx, {
            typeId: fx.typeId,
            cardId: fx.cardId,
            occurredOn: '2026-03-15',
            amountCents,
        });

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
        await ctx.dataSource.query('DELETE FROM credit_card_refunds');
        await cleanFixture(ctx);
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(() => {
        received = [];
        unsubscribe = container
            .resolve<DomainEventDispatcher>(DomainEventDispatcherSymbol)
            .subscribe<CreditCardRefundRegistered>(CREDIT_CARD_REFUND_REGISTERED, (event) => {
                received.push(event);

                return Promise.resolve();
            });
    });

    afterEach(async () => {
        unsubscribe();
        await ctx.dataSource.query('DELETE FROM credit_card_refunds');
        await ctx.dataSource.query('DELETE FROM expenses');
        await ctx.dataSource.query(
            'UPDATE credit_cards SET available_limit_cents = 500, archived_at = NULL',
        );
    });

    it('AC-0013-12, INV-0013-11: lançar o estorno devolve o valor ao limite e responde 201 com o corpo da spec', async () => {
        const expenseId = await cardExpense();

        const res = await post({ expenseId, notes: 'Cancelada' });

        expect(res.status).toBe(201);
        expect(res.body.data).toEqual({
            id: expect.any(String) as string,
            creditCardId: fx.cardId,
            expenseId,
            description: 'Estorno',
            amountCents: 30000,
            occurredOn: '2026-03-18',
            postedOn: '2026-03-18',
            notes: 'Cancelada',
            createdAt: expect.any(String) as string,
            updatedAt: expect.any(String) as string,
        });
        expect(await availableLimit()).toBe(INITIAL_LIMIT + 30000);
    });

    it('AC-0013-12, ERR-0013-14: estornos de uma despesa somando mais que ela recebem 409 REFUND_EXCEEDS_EXPENSE', async () => {
        const expenseId = await cardExpense(40000);

        expect((await post({ expenseId })).status).toBe(201);

        const res = await post({ expenseId, amountCents: 10001 });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('REFUND_EXCEEDS_EXPENSE');
        expect(res.body.error.message).toContain('10000');
        expect(await refundCount()).toBe(1);
        expect(await availableLimit()).toBe(INITIAL_LIMIT + 30000);
        expect((await post({ expenseId, amountCents: 10000 })).status).toBe(201);
        expect(await availableLimit()).toBe(INITIAL_LIMIT + 40000);
    });

    it('AC-0013-12, ERR-0013-13: despesa de conta ou de outro cartão recebe 409 REFUND_EXPENSE_MISMATCH', async () => {
        const bankId = (
            (await ctx.dataSource.query('SELECT id FROM banks LIMIT 1')) as [{ id: string }]
        )[0].id;
        const otherCard = (
            await request(ctx.app).post('/credit-cards').set('Authorization', ADMIN).send({
                bankId,
                name: 'Outro',
                creditLimitCents: 10000,
                closingDay: 10,
                dueDay: 20,
            })
        ).body.data.id as string;
        const ofAccount = await insertExpense(ctx, { typeId: fx.typeId, accountId: fx.accountId });
        const ofOtherCard = await insertExpense(ctx, { typeId: fx.typeId, cardId: otherCard });

        for (const expenseId of [ofAccount, ofOtherCard]) {
            const res = await post({ expenseId });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('REFUND_EXPENSE_MISMATCH');
        }

        expect(await refundCount()).toBe(0);
        expect(await availableLimit()).toBe(INITIAL_LIMIT);
    });

    it('ERR-0013-05: despesa ou cartão inexistente recebe 404', async () => {
        const noExpense = await post({ expenseId: randomUUID() });
        const noCard = await post({ creditCardId: randomUUID() });

        expect(noExpense.status).toBe(404);
        expect(noExpense.body.error.code).toBe('EXPENSE_NOT_FOUND');
        expect(noCard.status).toBe(404);
        expect(noCard.body.error.code).toBe('CREDIT_CARD_NOT_FOUND');
        expect(await refundCount()).toBe(0);
    });

    it('AC-0013-10: sem postedOn o estorno antigo cai na fatura aberta; postedOn na janela fechada recebe 409', async () => {
        const defaulted = await post({ occurredOn: '2026-03-05' });
        const closed = await post({ occurredOn: '2026-03-05', postedOn: CLOSED_THROUGH });
        const firstOpenDay = await post({ occurredOn: '2026-03-05', postedOn: '2026-03-11' });

        expect(defaulted.status).toBe(201);
        expect(defaulted.body.data.postedOn).toBe('2026-03-11');
        expect(closed.status).toBe(409);
        expect(closed.body.error.code).toBe('STATEMENT_CLOSED');
        expect(closed.body.error.message).toContain(CLOSED_THROUGH);
        expect(firstOpenDay.status).toBe(201);
        expect(await refundCount()).toBe(2);
        expect(await availableLimit()).toBe(INITIAL_LIMIT + 60000);
    });

    it('AC-0013-10, INV-0013-11: excluir o estorno consome o limite de novo e responde 204', async () => {
        const id = (await post({})).body.data.id as string;

        expect(await availableLimit()).toBe(INITIAL_LIMIT + 30000);

        const res = await remove(id);

        expect(res.status).toBe(204);
        expect(await refundCount()).toBe(0);
        expect(await availableLimit()).toBe(INITIAL_LIMIT);
        expect((await remove(id)).status).toBe(404);
    });

    it('AC-0013-10, ERR-0013-08: excluir estorno da janela fechada recebe 409 STATEMENT_CLOSED e nada muda', async () => {
        const id = await closedRefund();

        const res = await remove(id);

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('STATEMENT_CLOSED');
        expect(res.body.error.message).toContain(CLOSED_THROUGH);
        expect(await refundCount()).toBe(1);
        expect(await availableLimit()).toBe(INITIAL_LIMIT);
    });

    it('AC-0013-10: description e notes de estorno da janela fechada são aceitos', async () => {
        const id = await closedRefund();

        const res = await patch(id, { description: 'Corrigido', notes: 'Obs' });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ description: 'Corrigido', notes: 'Obs' });
        expect(res.body.data.amountCents).toBe(5000);
        expect((await patch(id, { notes: null })).body.data.notes).toBeNull();
    });

    it('ERR-0013-16: PATCH com campo além de description e notes, ou vazio, é 400 citando o campo', async () => {
        const id = (await post({})).body.data.id as string;

        for (const field of ['amountCents', 'postedOn', 'occurredOn', 'expenseId']) {
            const res = await patch(id, { [field]: field === 'amountCents' ? 1 : '2026-03-19' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(JSON.stringify(res.body)).toContain(field);
        }

        const empty = await patch(id, {});

        expect(empty.status).toBe(400);
        expect(empty.body.error.code).toBe('VALIDATION_ERROR');
        expect(await availableLimit()).toBe(INITIAL_LIMIT + 30000);
    });

    it('ERR-0013-15: amountCents ≤ 0 ou fracionário e postedOn antes de occurredOn são 400 citando o campo', async () => {
        const cases: [Record<string, unknown>, string][] = [
            [{ amountCents: 0 }, 'amountCents'],
            [{ amountCents: -5 }, 'amountCents'],
            [{ amountCents: 10.5 }, 'amountCents'],
            [{ postedOn: '2026-03-17' }, 'postedOn'],
        ];

        for (const [body, field] of cases) {
            const res = await post(body);

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(JSON.stringify(res.body)).toContain(field);
        }

        expect(await refundCount()).toBe(0);
    });

    it('cartão arquivado aceita estorno', async () => {
        await ctx.dataSource.query('UPDATE credit_cards SET archived_at = now()');

        const res = await post({});

        expect(res.status).toBe(201);
        expect(await availableLimit()).toBe(INITIAL_LIMIT + 30000);
    });

    it('ERR-0013-01: consultar, alterar ou excluir estorno inexistente recebe 404 CREDIT_CARD_REFUND_NOT_FOUND', async () => {
        const id = randomUUID();
        const responses = [
            await get(`/credit-card-refunds/${id}`),
            await patch(id, { description: 'x' }),
            await remove(id),
        ];

        for (const res of responses) {
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('CREDIT_CARD_REFUND_NOT_FOUND');
        }
    });

    it('GET /credit-card-refunds filtra por cartão, despesa e postedOn, em ordem de postedOn', async () => {
        const expenseId = await cardExpense();
        const late = (await post({ occurredOn: '2026-03-19', amountCents: 100 })).body.data
            .id as string;
        const early = (await post({ expenseId, amountCents: 200 })).body.data.id as string;

        const all = await get(`/credit-card-refunds?creditCardId=${fx.cardId}`);
        const byExpense = await get(`/credit-card-refunds?expenseId=${expenseId}`);
        const byRange = await get('/credit-card-refunds?from=2026-03-19&to=2026-03-19');
        const one = await get(`/credit-card-refunds/${late}`);

        expect(all.body.data.map((r: { id: string }) => r.id)).toEqual([early, late]);
        expect(byExpense.body.data.map((r: { id: string }) => r.id)).toEqual([early]);
        expect(byRange.body.data.map((r: { id: string }) => r.id)).toEqual([late]);
        expect(one.body.data.id).toBe(late);
    });

    it('filtros inválidos da listagem são 400 citando o campo', async () => {
        const badId = await get('/credit-card-refunds?creditCardId=abc');
        const badDate = await get('/credit-card-refunds?from=ontem');
        const inverted = await get('/credit-card-refunds?from=2026-03-20&to=2026-03-01');

        expect(badId.status).toBe(400);
        expect(JSON.stringify(badId.body)).toContain('creditCardId');
        expect(badDate.status).toBe(400);
        expect(JSON.stringify(badDate.body)).toContain('from');
        expect(inverted.status).toBe(400);
        expect(inverted.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('INV-0013-11: o evento CreditCardRefundRegistered sai uma vez, após o commit, e não sai na recusa', async () => {
        const expenseId = await cardExpense();

        const refused = await post({ occurredOn: '2026-03-05', postedOn: CLOSED_THROUGH });
        const res = await post({ expenseId });

        expect(refused.status).toBe(409);
        expect(received).toHaveLength(1);
        expect(received[0]?.name).toBe('CreditCardRefundRegistered');
        expect(received[0]?.payload).toEqual({
            refundId: res.body.data.id,
            creditCardId: fx.cardId,
            expenseId,
            amountCents: 30000,
            occurredOn: '2026-03-18',
            postedOn: '2026-03-18',
        });
    });

    it('INV-0013-11: estornos concorrentes no mesmo cartão devolvem a soma exata ao limite', async () => {
        const responses = await Promise.all(
            [1000, 2000, 3000, 4000, 5000].map((amountCents) => post({ amountCents })),
        );

        expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
        expect(await availableLimit()).toBe(INITIAL_LIMIT + 15000);

        const deletes = await Promise.all(responses.map((r) => remove(r.body.data.id as string)));

        expect(deletes.map((r) => r.status)).toEqual([204, 204, 204, 204, 204]);
        expect(await availableLimit()).toBe(INITIAL_LIMIT);
    }, 30000);

    it('INV-0013-11: estornos concorrentes da mesma despesa nunca passam do valor dela', async () => {
        const expenseId = await cardExpense(10000);

        const responses = await Promise.all(
            Array.from({ length: 4 }, () => post({ expenseId, amountCents: 4000 })),
        );
        const statuses = responses.map((r) => r.status).sort();

        expect(statuses).toEqual([201, 201, 409, 409]);
        expect(await availableLimit()).toBe(INITIAL_LIMIT + 8000);
    }, 30000);

    it('AC-0013-23: VIEWER lista e consulta, e recebe 403 FORBIDDEN em toda escrita', async () => {
        const id = (await post({})).body.data.id as string;
        const uid = 'uid-viewer-refunds';

        await request(ctx.app).get('/users/me').set('Authorization', `Bearer ${uid}`);
        await ctx.setProfile(uid, 'VIEWER');

        const auth = `Bearer ${uid}`;
        const reads = [
            await request(ctx.app).get('/credit-card-refunds').set('Authorization', auth),
            await request(ctx.app).get(`/credit-card-refunds/${id}`).set('Authorization', auth),
        ];
        const writes = [
            await post({}, auth),
            await request(ctx.app)
                .patch(`/credit-card-refunds/${id}`)
                .set('Authorization', auth)
                .send({ description: 'x' }),
            await request(ctx.app).delete(`/credit-card-refunds/${id}`).set('Authorization', auth),
        ];

        expect(reads.map((r) => r.status)).toEqual([200, 200]);

        for (const res of writes) {
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('FORBIDDEN');
        }

        expect(await refundCount()).toBe(1);
        expect(await availableLimit()).toBe(INITIAL_LIMIT + 30000);
    });
});
