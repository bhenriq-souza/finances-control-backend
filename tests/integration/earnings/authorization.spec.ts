import request from 'supertest';

import { Earning } from '../../../src/earnings';
import { MISSING, useEarningFixtures } from './earning-fixtures.helper';

describe('autorização de /earnings (spec 0014, AC-0014-12, INV-0014-08)', () => {
    const fx = useEarningFixtures('test_earnings_authorization');

    const as = async (profile: 'ADMIN' | 'BILLER' | 'VIEWER' | null): Promise<string> => {
        const uid = `uid-${profile ?? 'pending'}-x`;
        await request(fx.ctx.app).get('/users/me').set('Authorization', `Bearer ${uid}`);
        await fx.ctx.setProfile(uid, profile);

        return `Bearer ${uid}`;
    };

    const createBody = () => ({
        description: 'Salário',
        earningTypeId: fx.typeId,
        kind: 'FIXED',
        amountCents: 1000,
        occurredOn: '2026-03-10',
        bankAccountId: fx.accountId,
    });

    /** Uma chamada por rota de escrita; cada uma é montada sob demanda. */
    const writes = (auth: string, id: string) => [
        () => request(fx.ctx.app).post('/earnings').set('Authorization', auth).send(createBody()),
        () =>
            request(fx.ctx.app)
                .patch(`/earnings/${id}`)
                .set('Authorization', auth)
                .send({ notes: 'x' }),
        () =>
            request(fx.ctx.app)
                .patch(`/earnings/${id}/status`)
                .set('Authorization', auth)
                .send({ status: 'VERIFYING' }),
        () => request(fx.ctx.app).delete(`/earnings/${id}`).set('Authorization', auth),
    ];

    it('VIEWER lista e consulta', async () => {
        const id = await fx.seed('OPEN');
        const auth = await as('VIEWER');

        const listed = await request(fx.ctx.app).get('/earnings').set('Authorization', auth);
        const found = await request(fx.ctx.app).get(`/earnings/${id}`).set('Authorization', auth);

        expect(listed.status).toBe(200);
        expect(found.status).toBe(200);
    });

    it('VIEWER recebe 403 FORBIDDEN em toda escrita, sem efeito', async () => {
        const id = await fx.seed('OPEN');
        const auth = await as('VIEWER');

        for (const send of writes(auth, id)) {
            const response = await send();

            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe('FORBIDDEN');
        }
        const earning = await fx.ctx.dataSource.getRepository(Earning).findOneByOrFail({ id });
        expect(earning.status).toBe('OPEN');
        expect(earning.notes).toBeNull();
        expect(await fx.ctx.dataSource.getRepository(Earning).count()).toBe(1);
    });

    it.each(['ADMIN', 'BILLER'] as const)('%s escreve', async (profile) => {
        const id = await fx.seed('OPEN');
        const auth = await as(profile);
        const [create, update, status, remove] = writes(auth, id);

        expect((await create!()).status).toBe(201);
        expect((await update!()).status).toBe(200);
        expect((await status!()).status).toBe(200);
        expect((await remove!()).status).toBe(204);
    });

    it('sem perfil recebe 403 PROFILE_PENDING na leitura e na escrita', async () => {
        const id = await fx.seed('OPEN');
        const auth = await as(null);

        const read = await request(fx.ctx.app).get('/earnings').set('Authorization', auth);
        expect(read.status).toBe(403);
        expect(read.body.error.code).toBe('PROFILE_PENDING');

        for (const send of writes(auth, id)) {
            const response = await send();

            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe('PROFILE_PENDING');
        }
    });

    it('sem token recebe 401', async () => {
        expect((await request(fx.ctx.app).get('/earnings')).status).toBe(401);
        expect((await request(fx.ctx.app).delete(`/earnings/${MISSING}`)).status).toBe(401);
    });
});
