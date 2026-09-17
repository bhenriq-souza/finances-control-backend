import 'reflect-metadata';
import request from 'supertest';
import { CustomError } from '@bhs-dev/typescript-common-errors';

import { User, UserService } from '../../../src/identity';
import { startIdentityApp, stopIdentityApp, type IdentityTestApp } from './identity-app.helper';

const SCHEMA = 'test_identity_guardrails';
const ADMIN = 'Bearer uid-admin';

describe('travas de segurança do perfil (spec 0010)', () => {
    let ctx: IdentityTestApp;
    let adminId: string;

    beforeAll(async () => {
        ctx = await startIdentityApp(SCHEMA);
    });

    afterAll(async () => {
        await stopIdentityApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        await request(ctx.app).get('/users/me').set('Authorization', ADMIN);
        adminId = (await ctx.setProfile('uid-admin', 'ADMIN')).id;
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM users');
    });

    describe('ninguém muda o próprio perfil (AC-0010-09, INV-0010-05)', () => {
        it('PATCH sobre si mesmo responde 409 CANNOT_CHANGE_OWN_PROFILE', async () => {
            const response = await request(ctx.app)
                .patch(`/users/${adminId}/profile`)
                .set('Authorization', ADMIN)
                .send({ profile: 'VIEWER' });

            expect(response.status).toBe(409);
            expect(response.body.error.code).toBe('CANNOT_CHANGE_OWN_PROFILE');
        });

        it('DELETE sobre si mesmo idem', async () => {
            const response = await request(ctx.app)
                .delete(`/users/${adminId}/profile`)
                .set('Authorization', ADMIN);

            expect(response.status).toBe(409);
            expect(response.body.error.code).toBe('CANNOT_CHANGE_OWN_PROFILE');
        });

        it('e o banco não muda', async () => {
            await request(ctx.app).delete(`/users/${adminId}/profile`).set('Authorization', ADMIN);

            await expect(ctx.findByUid('uid-admin')).resolves.toMatchObject({ profile: 'ADMIN' });
        });

        it('um Admin altera outro Admin normalmente', async () => {
            await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-admin-2');
            const second = await ctx.setProfile('uid-admin-2', 'ADMIN', adminId);

            const response = await request(ctx.app)
                .patch(`/users/${second.id}/profile`)
                .set('Authorization', ADMIN)
                .send({ profile: 'VIEWER' });

            expect(response.status).toBe(200);
            expect(response.body.data.profile).toBe('VIEWER');
        });
    });

    describe('a plataforma nunca fica sem Admin (AC-0010-10, INV-0010-06)', () => {
        const serviceOf = (ctx: IdentityTestApp) => new UserService(ctx.dataSource);

        /**
         * Pelo HTTP este caso é inalcançável: só um ADMIN chama, e ele não pode
         * mirar em si mesmo — então sempre sobra pelo menos ele. A trava existe
         * como defesa em profundidade, e é no serviço que dá para exercitá-la.
         */
        it('revogar o último Admin é recusado com LAST_ADMIN', async () => {
            const other = await ctx.dataSource.getRepository(User).save({
                firebaseUid: 'uid-sem-perfil',
                email: 'sem-perfil@exemplo.com',
                name: 'Sem Perfil',
                profile: null,
                profileGrantedAt: null,
                profileGrantedById: null,
            });

            const error = await serviceOf(ctx)
                .revokeProfile({ targetId: adminId, actorId: other.id })
                .catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(CustomError);
            expect(error).toMatchObject({ status: 409, code: 'LAST_ADMIN' });
        });

        it('e o banco não muda', async () => {
            const other = await ctx.dataSource.getRepository(User).save({
                firebaseUid: 'uid-sem-perfil',
                email: 'sem-perfil@exemplo.com',
                name: 'Sem Perfil',
                profile: null,
                profileGrantedAt: null,
                profileGrantedById: null,
            });

            await serviceOf(ctx)
                .revokeProfile({ targetId: adminId, actorId: other.id })
                .catch(() => undefined);

            await expect(ctx.findByUid('uid-admin')).resolves.toMatchObject({ profile: 'ADMIN' });
        });

        it('rebaixar o último Admin também é recusado', async () => {
            const other = await ctx.dataSource.getRepository(User).save({
                firebaseUid: 'uid-sem-perfil',
                email: 'sem-perfil@exemplo.com',
                name: 'Sem Perfil',
                profile: null,
                profileGrantedAt: null,
                profileGrantedById: null,
            });

            const error = await serviceOf(ctx)
                .grantProfile({ targetId: adminId, profile: 'VIEWER', actorId: other.id })
                .catch((caught: unknown) => caught);

            expect(error).toMatchObject({ status: 409, code: 'LAST_ADMIN' });
        });

        it('havendo outro Admin, a revogação passa', async () => {
            await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-admin-2');
            const second = await ctx.setProfile('uid-admin-2', 'ADMIN', adminId);

            const revoked = await serviceOf(ctx).revokeProfile({
                targetId: adminId,
                actorId: second.id,
            });

            expect(revoked.profile).toBeNull();
        });

        it('promover alguém a ADMIN nunca esbarra na trava', async () => {
            await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-novo');
            const target = (await ctx.findByUid('uid-novo'))!;

            const granted = await serviceOf(ctx).grantProfile({
                targetId: target.id,
                profile: 'ADMIN',
                actorId: adminId,
            });

            expect(granted.profile).toBe('ADMIN');
        });
    });
});
