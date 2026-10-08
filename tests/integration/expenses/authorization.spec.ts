import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../app.helper';
import { cleanFixture, insertExpense, seedFixture, type Fixture } from './fixture.helper';

const SCHEMA = 'test_expenses_authorization';

describe('autorização de /expenses (AC-0012-18, INV-0012-12)', () => {
    let ctx: TestApp;
    let fx: Fixture;
    let expenseId: string;

    const as = async (profile: 'ADMIN' | 'BILLER' | 'VIEWER' | null): Promise<string> => {
        const uid = `uid-${profile ?? 'pending'}-x`;
        await request(ctx.app).get('/users/me').set('Authorization', `Bearer ${uid}`);
        await ctx.setProfile(uid, profile);

        return `Bearer ${uid}`;
    };

    const body = () => ({
        description: 'Compra',
        expenseTypeId: fx.typeId,
        kind: 'VARIABLE',
        amountCents: 1000,
        occurredOn: '2026-03-10',
        bankAccountId: fx.accountId,
    });

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        fx = await seedFixture(ctx);
        expenseId = await insertExpense(ctx, { typeId: fx.typeId, accountId: fx.accountId });
    });

    afterEach(async () => {
        await cleanFixture(ctx);
    });

    it('VIEWER lista e consulta', async () => {
        const auth = await as('VIEWER');

        const listed = await request(ctx.app).get('/expenses').set('Authorization', auth);
        const one = await request(ctx.app).get(`/expenses/${expenseId}`).set('Authorization', auth);

        expect([listed.status, one.status]).toEqual([200, 200]);
    });

    it('VIEWER recebe 403 FORBIDDEN em toda escrita', async () => {
        const auth = await as('VIEWER');
        const attempts = [
            request(ctx.app).post('/expenses').set('Authorization', auth).send(body()),
            request(ctx.app)
                .patch(`/expenses/${expenseId}`)
                .set('Authorization', auth)
                .send({ description: 'x' }),
            request(ctx.app)
                .patch(`/expenses/${expenseId}/status`)
                .set('Authorization', auth)
                .send({ status: 'VERIFYING' }),
            request(ctx.app).delete(`/expenses/${expenseId}`).set('Authorization', auth),
        ];

        for (const response of await Promise.all(attempts)) {
            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe('FORBIDDEN');
        }

        const rows = (await ctx.dataSource.query('SELECT count(*) AS n FROM expenses')) as [
            { n: string },
        ];
        expect(Number(rows[0].n)).toBe(1);
    });

    it('BILLER e ADMIN escrevem: lançam, alteram e excluem', async () => {
        for (const profile of ['BILLER', 'ADMIN'] as const) {
            const auth = await as(profile);

            const created = await request(ctx.app)
                .post('/expenses')
                .set('Authorization', auth)
                .send(body());
            expect(created.status).toBe(201);
            const id = created.body.data[0].id as string;

            const updated = await request(ctx.app)
                .patch(`/expenses/${id}`)
                .set('Authorization', auth)
                .send({ description: 'Nova' });
            expect(updated.status).toBe(200);

            const removed = await request(ctx.app)
                .delete(`/expenses/${id}`)
                .set('Authorization', auth);
            expect(removed.status).toBe(204);
        }
    });

    it('sem perfil recebe 403 PROFILE_PENDING em leitura e escrita', async () => {
        const auth = await as(null);
        const attempts = [
            request(ctx.app).get('/expenses').set('Authorization', auth),
            request(ctx.app).get(`/expenses/${expenseId}`).set('Authorization', auth),
            request(ctx.app).delete(`/expenses/${expenseId}`).set('Authorization', auth),
        ];

        for (const response of await Promise.all(attempts)) {
            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe('PROFILE_PENDING');
        }
    });

    it('sem token recebe 401', async () => {
        const res = await request(ctx.app).get(`/expenses/${randomUUID()}`);

        expect(res.status).toBe(401);
    });
});
