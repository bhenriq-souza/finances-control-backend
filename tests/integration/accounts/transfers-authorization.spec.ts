import request from 'supertest';
import type { DataSource } from 'typeorm';

import { BankAccount } from '../../../src/accounts';
import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_accounts_transfers_authorization';

describe('autorização de /bank-transfers (AC-0018-12, INV-0018-08)', () => {
    let ctx: TestApp;
    let dataSource: DataSource;
    let accountA: string;
    let accountB: string;
    let transferId: string;

    const body = (extra: Record<string, unknown> = {}) => ({
        fromBankAccountId: accountA,
        toBankAccountId: accountB,
        amountCents: 1000,
        occurredOn: '2026-03-10',
        description: 'Reserva',
        ...extra,
    });

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        dataSource = ctx.dataSource;
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        const [bank] = await dataSource.query<{ id: string }[]>(
            "INSERT INTO banks (febraban_code, name) VALUES ('260', 'Nu Pagamentos') RETURNING id",
        );
        const repository = dataSource.getRepository(BankAccount);
        const make = (accountNumber: string) =>
            repository.save(
                repository.create({
                    bankId: bank!.id,
                    type: 'CHECKING',
                    accountNumber,
                    description: accountNumber,
                    openingBalanceCents: 100000,
                    currentBalanceCents: 100000,
                    overdraftLimitCents: 0,
                    archivedAt: null,
                }),
            );

        accountA = (await make('A')).id;
        accountB = (await make('B')).id;

        await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-admin');
        await ctx.setProfile('uid-admin', 'ADMIN');

        const created = await request(ctx.app)
            .post('/bank-transfers')
            .set('Authorization', 'Bearer uid-admin')
            .send(body({ status: 'SCHEDULED' }));
        transferId = created.body.data.id;
    });

    afterEach(async () => {
        await dataSource.query('DELETE FROM bank_transfers');
        await dataSource.query('DELETE FROM bank_accounts');
        await dataSource.query('DELETE FROM banks');
    });

    const as = async (profile: 'ADMIN' | 'BILLER' | 'VIEWER' | null): Promise<string> => {
        const uid = `uid-${profile ?? 'pending'}-x`;
        await request(ctx.app).get('/users/me').set('Authorization', `Bearer ${uid}`);
        await ctx.setProfile(uid, profile);
        return `Bearer ${uid}`;
    };

    it('VIEWER lista e consulta', async () => {
        const auth = await as('VIEWER');

        const list = await request(ctx.app).get('/bank-transfers').set('Authorization', auth);
        expect(list.status).toBe(200);

        const one = await request(ctx.app)
            .get(`/bank-transfers/${transferId}`)
            .set('Authorization', auth);
        expect(one.status).toBe(200);
    });

    it('VIEWER recebe 403 FORBIDDEN em toda escrita', async () => {
        const auth = await as('VIEWER');
        const attempts = [
            request(ctx.app).post('/bank-transfers').set('Authorization', auth).send(body()),
            request(ctx.app)
                .patch(`/bank-transfers/${transferId}`)
                .set('Authorization', auth)
                .send({ description: 'x' }),
            request(ctx.app)
                .patch(`/bank-transfers/${transferId}/status`)
                .set('Authorization', auth)
                .send({ status: 'COMPLETED' }),
            request(ctx.app).delete(`/bank-transfers/${transferId}`).set('Authorization', auth),
        ];

        for (const response of await Promise.all(attempts)) {
            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe('FORBIDDEN');
        }
    });

    it('BILLER transfere, altera, conclui e exclui', async () => {
        const auth = await as('BILLER');

        const created = await request(ctx.app)
            .post('/bank-transfers')
            .set('Authorization', auth)
            .send(body());
        expect(created.status).toBe(201);

        const changed = await request(ctx.app)
            .patch(`/bank-transfers/${transferId}`)
            .set('Authorization', auth)
            .send({ description: 'x' });
        expect(changed.status).toBe(200);

        const completed = await request(ctx.app)
            .patch(`/bank-transfers/${transferId}/status`)
            .set('Authorization', auth)
            .send({ status: 'COMPLETED' });
        expect(completed.status).toBe(200);

        const other = await request(ctx.app)
            .post('/bank-transfers')
            .set('Authorization', auth)
            .send(body({ status: 'SCHEDULED' }));
        const deleted = await request(ctx.app)
            .delete(`/bank-transfers/${other.body.data.id}`)
            .set('Authorization', auth);
        expect(deleted.status).toBe(204);
    });

    it('sem perfil, tudo é 403 PROFILE_PENDING; sem token, 401', async () => {
        const auth = await as(null);
        const attempts = [
            request(ctx.app).get('/bank-transfers').set('Authorization', auth),
            request(ctx.app).get(`/bank-transfers/${transferId}`).set('Authorization', auth),
            request(ctx.app).post('/bank-transfers').set('Authorization', auth).send(body()),
            request(ctx.app)
                .patch(`/bank-transfers/${transferId}`)
                .set('Authorization', auth)
                .send({ description: 'x' }),
            request(ctx.app).delete(`/bank-transfers/${transferId}`).set('Authorization', auth),
        ];

        for (const attempt of attempts) {
            const response = await attempt;
            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe('PROFILE_PENDING');
        }

        expect((await request(ctx.app).get('/bank-transfers')).status).toBe(401);
    });
});
