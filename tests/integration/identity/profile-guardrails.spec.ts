import 'reflect-metadata';
import request from 'supertest';
import { CustomError } from '@bhs-dev/typescript-common-errors';

import { User, UserService } from '../../../src/identity';
import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_identity_guardrails';
const ADMIN = 'Bearer uid-admin';

describe('travas de segurança do perfil (spec 0010)', () => {
    let ctx: TestApp;
    let adminId: string;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        await request(ctx.app).get('/users/me').set('Authorization', ADMIN);
        adminId = (await ctx.setProfile('uid-admin', 'ADMIN')).id;
        // Gerir usuários é do admin da plataforma (spec 0021, INV-0021-08).
        await ctx.dataSource.query(
            'UPDATE users SET is_platform_admin = true WHERE firebase_uid = $1',
            ['uid-admin'],
        );
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM workspace_members');
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

            await expect(ctx.findByUid('uid-admin')).resolves.toMatchObject({
                membership: { profile: 'ADMIN' },
            });
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

    describe('o espaço nunca fica sem Admin (INV-0021-07, ERR-0021-09)', () => {
        const serviceOf = (ctx: TestApp) => new UserService(ctx.dataSource);

        // Remover o único membro não deixa espaço sem administrador: a trava só
        // vale quando sobra alguém (AC-0021-08).
        beforeEach(async () => {
            await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-viewer');
            await ctx.setProfile('uid-viewer', 'VIEWER', adminId);
        });

        /**
         * Pelo HTTP o caso é alcançável com outro espaço-membro; aqui o serviço o
         * exercita direto, com um ator que não é o alvo. O espaço precisa ter outro
         * membro para a remoção ser recusada (AC-0021-08).
         */
        it('revogar o último Admin é recusado com LAST_WORKSPACE_ADMIN', async () => {
            const other = await ctx.dataSource.getRepository(User).save({
                firebaseUid: 'uid-sem-perfil',
                email: 'sem-perfil@exemplo.com',
                name: 'Sem Perfil',
            });

            const error = await serviceOf(ctx)
                .revokeProfile({ targetId: adminId, actorId: other.id })
                .catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(CustomError);
            expect(error).toMatchObject({ status: 409, code: 'LAST_WORKSPACE_ADMIN' });
        });

        it('e o banco não muda', async () => {
            const other = await ctx.dataSource.getRepository(User).save({
                firebaseUid: 'uid-sem-perfil',
                email: 'sem-perfil@exemplo.com',
                name: 'Sem Perfil',
            });

            await serviceOf(ctx)
                .revokeProfile({ targetId: adminId, actorId: other.id })
                .catch(() => undefined);

            await expect(ctx.findByUid('uid-admin')).resolves.toMatchObject({
                membership: { profile: 'ADMIN' },
            });
        });

        it('rebaixar o último Admin também é recusado', async () => {
            const other = await ctx.dataSource.getRepository(User).save({
                firebaseUid: 'uid-sem-perfil',
                email: 'sem-perfil@exemplo.com',
                name: 'Sem Perfil',
            });

            const error = await serviceOf(ctx)
                .grantProfile({
                    targetId: adminId,
                    body: { profile: 'VIEWER' },
                    actorId: other.id,
                })
                .catch((caught: unknown) => caught);

            expect(error).toMatchObject({ status: 409, code: 'LAST_WORKSPACE_ADMIN' });
        });

        it('havendo outro Admin, a revogação passa', async () => {
            await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-admin-2');
            const second = await ctx.setProfile('uid-admin-2', 'ADMIN', adminId);

            const revoked = await serviceOf(ctx).revokeProfile({
                targetId: adminId,
                actorId: second.id,
            });

            expect(revoked.membership).toBeNull();
        });

        it('promover alguém a ADMIN nunca esbarra na trava', async () => {
            await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-novo');
            const target = (await ctx.findByUid('uid-novo'))!;

            const granted = await serviceOf(ctx).grantProfile({
                targetId: target.id,
                body: { profile: 'ADMIN', workspaceId: ctx.workspaceId },
                actorId: adminId,
            });

            expect(granted.membership?.profile).toBe('ADMIN');
        });
    });
});
