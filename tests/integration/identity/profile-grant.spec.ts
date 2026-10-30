import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_identity_profile_grant';
const ADMIN = 'Bearer uid-admin';

describe('concessão e revogação de perfil (spec 0010)', () => {
    let ctx: TestApp;
    let adminId: string;
    let targetId: string;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        await request(ctx.app).get('/users/me').set('Authorization', ADMIN);
        adminId = (await ctx.setProfile('uid-admin', 'ADMIN')).id;

        await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-alvo');
        targetId = (await ctx.findByUid('uid-alvo'))!.id;
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM workspace_members');
        await ctx.dataSource.query('DELETE FROM users');
    });

    describe('PATCH /users/:id/profile (AC-0010-06)', () => {
        it('grava perfil, data e quem concedeu', async () => {
            const response = await request(ctx.app)
                .patch(`/users/${targetId}/profile`)
                .set('Authorization', ADMIN)
                .send({ profile: 'BILLER' });

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({ id: targetId, profile: 'BILLER' });
            expect(response.body.data.profileGrantedAt).not.toBeNull();

            const stored = await ctx.findByUid('uid-alvo');
            expect(stored?.membership?.grantedById).toBe(adminId);
            // Pendente aprovado vira membro do espaço de quem concedeu (provisório até a
            // aprovação com espaço, T-0021-02).
            expect(stored?.membership?.workspaceId).toBe(ctx.workspaceId);
        });

        it('vale já na requisição seguinte do alvo, sem trocar de token', async () => {
            const before = await request(ctx.app)
                .get('/users')
                .set('Authorization', 'Bearer uid-alvo');
            expect(before.status).toBe(403);

            await request(ctx.app)
                .patch(`/users/${targetId}/profile`)
                .set('Authorization', ADMIN)
                .send({ profile: 'ADMIN' });

            const after = await request(ctx.app)
                .get('/users')
                .set('Authorization', 'Bearer uid-alvo');

            expect(after.status).toBe(200);
        });

        it('troca um perfil já concedido', async () => {
            await ctx.setProfile('uid-alvo', 'VIEWER', adminId);

            const response = await request(ctx.app)
                .patch(`/users/${targetId}/profile`)
                .set('Authorization', ADMIN)
                .send({ profile: 'BILLER' });

            expect(response.body.data.profile).toBe('BILLER');
        });

        it.each(['OWNER', '', 'admin', null])(
            'recusa o perfil %p (ERR-0010-09)',
            async (profile) => {
                const response = await request(ctx.app)
                    .patch(`/users/${targetId}/profile`)
                    .set('Authorization', ADMIN)
                    .send({ profile });

                expect(response.status).toBe(400);
                expect(response.body.error.code).toBe('VALIDATION_ERROR');
            },
        );

        it('recusa id que não é uuid antes de chegar ao banco', async () => {
            const response = await request(ctx.app)
                .patch('/users/nao-e-uuid/profile')
                .set('Authorization', ADMIN)
                .send({ profile: 'VIEWER' });

            expect(response.status).toBe(400);
        });

        it('responde 404 para usuário inexistente (ERR-0010-08)', async () => {
            const response = await request(ctx.app)
                .patch('/users/00000000-0000-4000-8000-000000000000/profile')
                .set('Authorization', ADMIN)
                .send({ profile: 'VIEWER' });

            expect(response.status).toBe(404);
            expect(response.body.error.code).toBe('USER_NOT_FOUND');
        });
    });

    describe('DELETE /users/:id/profile (AC-0010-07)', () => {
        it('devolve o usuário ao estado pendente', async () => {
            await ctx.setProfile('uid-alvo', 'BILLER', adminId);

            const response = await request(ctx.app)
                .delete(`/users/${targetId}/profile`)
                .set('Authorization', ADMIN);

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({ profile: null, profileGrantedAt: null });

            const stored = await ctx.findByUid('uid-alvo');
            expect(stored?.membership).toBeNull();
        });

        it('e o alvo volta a receber PROFILE_PENDING', async () => {
            await ctx.setProfile('uid-alvo', 'ADMIN', adminId);

            await request(ctx.app).delete(`/users/${targetId}/profile`).set('Authorization', ADMIN);

            const response = await request(ctx.app)
                .get('/users')
                .set('Authorization', 'Bearer uid-alvo');

            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe('PROFILE_PENDING');
        });

        it('responde 404 para usuário inexistente', async () => {
            const response = await request(ctx.app)
                .delete('/users/00000000-0000-4000-8000-000000000000/profile')
                .set('Authorization', ADMIN);

            expect(response.status).toBe(404);
        });
    });

    describe('email verificado pelo HTTP (AC-0010-15..17)', () => {
        const me = (token: string) => request(ctx.app).get('/users/me').set('Authorization', token);

        it('UserResponse traz emailVerified, acompanhando o último token (AC-0010-17)', async () => {
            const unverified = await me('Bearer uid-x~x@exemplo.com~false');
            expect(unverified.body.data.emailVerified).toBe(false);

            const verified = await me('Bearer uid-x~x@exemplo.com~true');
            expect(verified.body.data.emailVerified).toBe(true);
        });

        it('lista traz emailVerified de cada usuário (AC-0010-17)', async () => {
            const response = await request(ctx.app).get('/users').set('Authorization', ADMIN);

            expect(response.status).toBe(200);
            expect(response.body.data[0]).toHaveProperty('emailVerified');
        });

        it('re-vincula UID novo com email verificado e devolve o mesmo id e perfil (AC-0010-15)', async () => {
            await ctx.setProfile('uid-alvo', 'BILLER', adminId);

            const response = await me('Bearer uid-novo~uid-alvo@exemplo.com~true');

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({ id: targetId, profile: 'BILLER' });
            await expect(ctx.findByUid('uid-novo')).resolves.toMatchObject({ id: targetId });
        });

        it('recusa UID novo com email não verificado e não muda a linha (AC-0010-16)', async () => {
            const response = await me('Bearer uid-novo~uid-alvo@exemplo.com~false');

            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe('EMAIL_NOT_VERIFIED');
            await expect(ctx.findByUid('uid-alvo')).resolves.toMatchObject({ id: targetId });
            await expect(ctx.findByUid('uid-novo')).resolves.toBeNull();
        });
    });
});
