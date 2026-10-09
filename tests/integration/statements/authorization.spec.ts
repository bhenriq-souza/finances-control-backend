import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../app.helper';
import {
    ADMIN,
    cleanFixture,
    insertExpense,
    seedFixture,
    type Fixture,
} from '../expenses/fixture.helper';

const SCHEMA = 'test_statements_authorization';

const at = (iso: string): Date => new Date(`${iso}T15:00:00.000Z`);

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

type Profile = 'ADMIN' | 'BILLER' | 'VIEWER' | null;

/** "Today" is 2026-02-11: the cycle ending 2026-02-10 is closed (closing day 10). */
describe('autorização de /statements e /credit-card-refunds (AC-0013-23, INV-0013-13)', () => {
    let ctx: TestApp;
    let fx: Fixture;
    let statementId: string;
    let refundId: string;
    let paymentId: string;

    const as = async (profile: Profile): Promise<string> => {
        const uid = `uid-${profile ?? 'pending'}-x`;
        await request(ctx.app).get('/users/me').set('Authorization', `Bearer ${uid}`);
        await ctx.setProfile(uid, profile);

        return `Bearer ${uid}`;
    };

    const count = async (table: string): Promise<number> =>
        (
            (await ctx.dataSource.query(`SELECT count(*)::int AS n FROM ${table}`)) as [
                { n: number },
            ]
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
        await insertExpense(ctx, {
            typeId: fx.typeId,
            cardId: fx.cardId,
            occurredOn: '2026-02-03',
            amountCents: 1500,
        });

        const listed = await request(ctx.app)
            .get(`/statements?creditCardId=${fx.cardId}&from=2026-02-10&to=2026-02-10`)
            .set('Authorization', ADMIN);
        statementId = (listed.body.data as { id: string; closesOn: string }[]).find(
            (statement) => statement.closesOn === '2026-02-10',
        )!.id;

        const refund = await request(ctx.app)
            .post('/credit-card-refunds')
            .set('Authorization', ADMIN)
            .send({
                creditCardId: fx.cardId,
                description: 'Estorno',
                amountCents: 200,
                occurredOn: '2026-02-11',
            });
        refundId = refund.body.data.id as string;

        const payment = await request(ctx.app)
            .post(`/statements/${statementId}/payments`)
            .set('Authorization', ADMIN)
            .send({ bankAccountId: fx.accountId, amountCents: 100 });
        paymentId = (payment.body.data.payments as { id: string }[])[0]!.id;
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM credit_card_statement_payments');
        await ctx.dataSource.query('DELETE FROM credit_card_refunds');
        await ctx.dataSource.query('DELETE FROM credit_card_statements');
        await ctx.dataSource.query('DELETE FROM expenses');
        await ctx.dataSource.query(
            'UPDATE credit_cards SET available_limit_cents = 400, archived_at = NULL',
        );
        await ctx.dataSource.query(
            'UPDATE bank_accounts SET current_balance_cents = 1000, archived_at = NULL',
        );
    });

    it('VIEWER lista e consulta faturas e estornos', async () => {
        const auth = await as('VIEWER');
        const reads = [
            `/statements?creditCardId=${fx.cardId}`,
            `/statements/current?creditCardId=${fx.cardId}`,
            `/statements/${statementId}`,
            '/credit-card-refunds',
            `/credit-card-refunds/${refundId}`,
        ];

        for (const path of reads) {
            const res = await request(ctx.app).get(path).set('Authorization', auth);

            expect([path, res.status]).toEqual([path, 200]);
        }
    });

    it('VIEWER recebe 403 FORBIDDEN em toda escrita e nada muda', async () => {
        const auth = await as('VIEWER');
        const payments = await count('credit_card_statement_payments');
        const refunds = await count('credit_card_refunds');
        const attempts = [
            request(ctx.app)
                .post(`/statements/${statementId}/payments`)
                .set('Authorization', auth)
                .send({ bankAccountId: fx.accountId, amountCents: 100 }),
            request(ctx.app)
                .post('/statements/current/payments')
                .set('Authorization', auth)
                .send({ creditCardId: fx.cardId, bankAccountId: fx.accountId, amountCents: 100 }),
            request(ctx.app)
                .delete(`/statements/${statementId}/payments/${paymentId}`)
                .set('Authorization', auth),
            request(ctx.app)
                .delete(`/statements/current/payments/${randomUUID()}?creditCardId=${fx.cardId}`)
                .set('Authorization', auth),
            request(ctx.app)
                .patch(`/statements/${statementId}`)
                .set('Authorization', auth)
                .send({ minimumPaymentCents: 300 }),
            request(ctx.app).post('/credit-card-refunds').set('Authorization', auth).send({
                creditCardId: fx.cardId,
                description: 'Estorno',
                amountCents: 100,
                occurredOn: '2026-02-11',
            }),
            request(ctx.app)
                .patch(`/credit-card-refunds/${refundId}`)
                .set('Authorization', auth)
                .send({ description: 'Nova' }),
            request(ctx.app).delete(`/credit-card-refunds/${refundId}`).set('Authorization', auth),
        ];

        for (const response of await Promise.all(attempts)) {
            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe('FORBIDDEN');
        }

        expect(await count('credit_card_statement_payments')).toBe(payments);
        expect(await count('credit_card_refunds')).toBe(refunds);
    });

    it('BILLER paga, informa o mínimo, desfaz o pagamento e estorna', async () => {
        const auth = await as('BILLER');

        const paid = await request(ctx.app)
            .post(`/statements/${statementId}/payments`)
            .set('Authorization', auth)
            .send({ bankAccountId: fx.accountId, amountCents: 200 });
        expect(paid.status).toBe(201);

        const minimum = await request(ctx.app)
            .patch(`/statements/${statementId}`)
            .set('Authorization', auth)
            .send({ minimumPaymentCents: 300 });
        expect(minimum.status).toBe(200);

        const lastId = (paid.body.data.payments as { id: string }[]).at(-1)!.id;
        const undone = await request(ctx.app)
            .delete(`/statements/${statementId}/payments/${lastId}`)
            .set('Authorization', auth);
        expect(undone.status).toBe(204);

        const created = await request(ctx.app)
            .post('/credit-card-refunds')
            .set('Authorization', auth)
            .send({
                creditCardId: fx.cardId,
                description: 'Outro',
                amountCents: 100,
                occurredOn: '2026-02-11',
            });
        expect(created.status).toBe(201);

        const createdId = created.body.data.id as string;
        const renamed = await request(ctx.app)
            .patch(`/credit-card-refunds/${createdId}`)
            .set('Authorization', auth)
            .send({ description: 'Nova' });
        expect(renamed.status).toBe(200);

        const removed = await request(ctx.app)
            .delete(`/credit-card-refunds/${createdId}`)
            .set('Authorization', auth);
        expect(removed.status).toBe(204);
    });

    it('BILLER paga antecipado a fatura aberta e desfaz', async () => {
        const auth = await as('BILLER');

        // The closed statement has to be settled first (ERR-0013-17): 1500 - 200 refund, 100 paid.
        // The refund sits in the open statement, so the closed one owes 1500 - 100.
        await request(ctx.app)
            .post(`/statements/${statementId}/payments`)
            .set('Authorization', auth)
            .send({ bankAccountId: fx.accountId, amountCents: 1400 });
        await insertExpense(ctx, {
            typeId: fx.typeId,
            cardId: fx.cardId,
            occurredOn: '2026-02-11',
            amountCents: 500,
        });

        const early = await request(ctx.app)
            .post('/statements/current/payments')
            .set('Authorization', auth)
            .send({ creditCardId: fx.cardId, bankAccountId: fx.accountId, amountCents: 100 });
        expect(early.status).toBe(201);

        const earlyId = (early.body.data.payments as { id: string }[])[0]!.id;
        const undone = await request(ctx.app)
            .delete(`/statements/current/payments/${earlyId}?creditCardId=${fx.cardId}`)
            .set('Authorization', auth);
        expect(undone.status).toBe(204);
    });

    it('ADMIN também escreve', async () => {
        const auth = await as('ADMIN');

        const minimum = await request(ctx.app)
            .patch(`/statements/${statementId}`)
            .set('Authorization', auth)
            .send({ minimumPaymentCents: 300 });
        const removed = await request(ctx.app)
            .delete(`/credit-card-refunds/${refundId}`)
            .set('Authorization', auth);

        expect([minimum.status, removed.status]).toEqual([200, 204]);
    });

    it('sem perfil recebe 403 PROFILE_PENDING em leitura e escrita', async () => {
        const auth = await as(null);
        const attempts = [
            request(ctx.app)
                .get(`/statements?creditCardId=${fx.cardId}`)
                .set('Authorization', auth),
            request(ctx.app).get(`/statements/${statementId}`).set('Authorization', auth),
            request(ctx.app).get('/credit-card-refunds').set('Authorization', auth),
            request(ctx.app)
                .post(`/statements/${statementId}/payments`)
                .set('Authorization', auth)
                .send({ bankAccountId: fx.accountId, amountCents: 100 }),
            request(ctx.app).delete(`/credit-card-refunds/${refundId}`).set('Authorization', auth),
        ];

        for (const response of await Promise.all(attempts)) {
            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe('PROFILE_PENDING');
        }
    });

    it('sem token recebe 401', async () => {
        const res = await request(ctx.app).get(`/statements/${randomUUID()}`);

        expect(res.status).toBe(401);
    });
});
