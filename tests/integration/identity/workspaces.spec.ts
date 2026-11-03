import 'reflect-metadata';
import request from 'supertest';

import type { IEnvService } from '@bhs-dev/typescript-common-types';

import { UserProvisioningService } from '../../../src/identity';
import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_identity_workspaces';
const PLATFORM = 'Bearer uid-plataforma';

describe('espaços e membros no identity (spec 0021)', () => {
    let ctx: TestApp;
    let platformId: string;

    const as = (token: string) => ({
        get: (path: string) => request(ctx.app).get(path).set('Authorization', token),
        patch: (path: string, body: object = {}) =>
            request(ctx.app).patch(path).set('Authorization', token).send(body),
        delete: (path: string) => request(ctx.app).delete(path).set('Authorization', token),
    });
    const platform = as(PLATFORM);

    /** Cria o usuário pendente pelo primeiro acesso e devolve o id. */
    const pending = async (uid: string): Promise<string> => {
        await as(`Bearer ${uid}`).get('/users/me');

        return (await ctx.findByUid(uid))!.id;
    };

    const approveInNewWorkspace = (id: string, name: string) =>
        platform.patch(`/users/${id}/profile`, {
            profile: 'ADMIN',
            newWorkspace: { name },
        });

    const markPlatformAdmin = (uid: string) =>
        ctx.dataSource.query('UPDATE users SET is_platform_admin = true WHERE firebase_uid = $1', [
            uid,
        ]);

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        await as(PLATFORM).get('/users/me');
        platformId = (await ctx.setProfile('uid-plataforma', 'ADMIN')).id;
        await markPlatformAdmin('uid-plataforma');
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM bank_accounts');
        await ctx.dataSource.query('DELETE FROM banks');
        await ctx.dataSource.query('DELETE FROM workspace_members');
        await ctx.dataSource.query('DELETE FROM users');
        await ctx.dataSource.query('DELETE FROM workspaces WHERE id <> $1', [ctx.workspaceId]);
    });

    describe('aprovação com espaço novo (AC-0021-05)', () => {
        it('cria o espaço com o aprovado como único ADMIN e o /users/me traz o espaço', async () => {
            const id = await pending('uid-casa');

            const response = await approveInNewWorkspace(id, 'Casa');

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({
                profile: 'ADMIN',
                workspace: { name: 'Casa' },
                isPlatformAdmin: false,
            });

            const me = await as('Bearer uid-casa').get('/users/me');
            expect(me.body.data.workspace.name).toBe('Casa');

            const [{ count }] = (await ctx.dataSource.query(
                'SELECT count(*)::int AS count FROM workspace_members WHERE workspace_id = $1',
                [me.body.data.workspace.id],
            )) as [{ count: number }];
            expect(count).toBe(1);

            const stored = await ctx.findByUid('uid-casa');
            expect(stored?.membership?.grantedById).toBe(platformId);
        });

        it('o nome com espaços nas pontas é aparado', async () => {
            const id = await pending('uid-casa');

            const response = await approveInNewWorkspace(id, '  Casa  ');

            expect(response.body.data.workspace.name).toBe('Casa');
        });
    });

    describe('aprovação em espaço existente (AC-0021-06)', () => {
        it('o VIEWER vira membro, lê o espaço e recebe 403 ao lançar', async () => {
            const adminId = await pending('uid-casa');
            const created = await approveInNewWorkspace(adminId, 'Casa');
            const workspaceId = created.body.data.workspace.id as string;

            const viewerId = await pending('uid-viewer');
            const response = await platform.patch(`/users/${viewerId}/profile`, {
                profile: 'VIEWER',
                workspaceId,
            });

            expect(response.status).toBe(200);
            expect(response.body.data.workspace).toEqual({ id: workspaceId, name: 'Casa' });

            const viewer = as('Bearer uid-viewer');
            const read = await viewer.get('/bank-accounts');
            expect(read.status).toBe(200);

            const write = await request(ctx.app)
                .post('/bank-accounts')
                .set('Authorization', 'Bearer uid-viewer')
                .send({});
            expect(write.status).toBe(403);
        });
    });

    describe('troca de perfil e membro existente (AC-0021-07, ERR-0021-08)', () => {
        it('{ profile } troca o perfil e mantém o espaço', async () => {
            const adminId = await pending('uid-casa');
            const workspaceId = (await approveInNewWorkspace(adminId, 'Casa')).body.data.workspace
                .id as string;
            const memberId = await pending('uid-membro');
            await platform.patch(`/users/${memberId}/profile`, { profile: 'VIEWER', workspaceId });

            const response = await platform.patch(`/users/${memberId}/profile`, {
                profile: 'BILLER',
            });

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({
                profile: 'BILLER',
                workspace: { id: workspaceId },
            });
        });

        it('workspaceId para quem já é membro responde 409 USER_ALREADY_IN_WORKSPACE', async () => {
            const adminId = await pending('uid-casa');
            const workspaceId = (await approveInNewWorkspace(adminId, 'Casa')).body.data.workspace
                .id as string;

            const response = await platform.patch(`/users/${adminId}/profile`, {
                profile: 'ADMIN',
                workspaceId,
            });

            expect(response.status).toBe(409);
            expect(response.body.error.code).toBe('USER_ALREADY_IN_WORKSPACE');
        });

        it('newWorkspace para quem já é membro responde 409 USER_ALREADY_IN_WORKSPACE (ERR-0021-08)', async () => {
            const adminId = await pending('uid-casa');
            await approveInNewWorkspace(adminId, 'Casa');

            const response = await approveInNewWorkspace(adminId, 'Outra');

            expect(response.status).toBe(409);
            expect(response.body.error.code).toBe('USER_ALREADY_IN_WORKSPACE');
            const list = await platform.get('/workspaces');
            expect(list.body.data).toHaveLength(2); // o do admin da plataforma e Casa
        });
    });

    describe('remoção e último ADMIN (AC-0021-08, ERR-0021-09, INV-0021-07)', () => {
        let workspaceId: string;
        let adminId: string;
        let memberId: string;

        beforeEach(async () => {
            adminId = await pending('uid-casa');
            workspaceId = (await approveInNewWorkspace(adminId, 'Casa')).body.data.workspace
                .id as string;
            memberId = await pending('uid-membro');
            await platform.patch(`/users/${memberId}/profile`, { profile: 'VIEWER', workspaceId });
        });

        it('remover o membro o devolve a pendente e os registros do espaço ficam', async () => {
            await ctx.dataSource.query(
                "INSERT INTO banks (febraban_code, name) VALUES ('260', 'Nu') ON CONFLICT DO NOTHING",
            );
            await ctx.dataSource.query(
                `INSERT INTO bank_accounts (workspace_id, bank_id, type, account_number, description,
                                            opening_balance_cents, current_balance_cents)
                 VALUES ($1, (SELECT id FROM banks WHERE febraban_code = '260'), 'CHECKING', '123', 'Conta', 0, 0)`,
                [workspaceId],
            );
            const before = (await ctx.dataSource.query(
                'SELECT count(*)::int AS n FROM bank_accounts WHERE workspace_id = $1',
                [workspaceId],
            )) as [{ n: number }];

            const response = await platform.delete(`/users/${memberId}/profile`);

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({ profile: null, workspace: null });

            const blocked = await as('Bearer uid-membro').get('/bank-accounts');
            expect(blocked.status).toBe(403);
            expect(blocked.body.error.code).toBe('PROFILE_PENDING');

            const after = (await ctx.dataSource.query(
                'SELECT count(*)::int AS n FROM bank_accounts WHERE workspace_id = $1',
                [workspaceId],
            )) as [{ n: number }];
            expect(before[0].n).toBe(1);
            expect(after[0].n).toBe(1);
        });

        it('remover o último ADMIN de um espaço com outros membros responde 409 LAST_WORKSPACE_ADMIN', async () => {
            const response = await platform.delete(`/users/${adminId}/profile`);

            expect(response.status).toBe(409);
            expect(response.body.error.code).toBe('LAST_WORKSPACE_ADMIN');
            await expect(ctx.findByUid('uid-casa')).resolves.toMatchObject({
                membership: { profile: 'ADMIN' },
            });
        });

        it('rebaixar o último ADMIN responde 409 LAST_WORKSPACE_ADMIN', async () => {
            const response = await platform.patch(`/users/${adminId}/profile`, {
                profile: 'BILLER',
            });

            expect(response.status).toBe(409);
            expect(response.body.error.code).toBe('LAST_WORKSPACE_ADMIN');
        });

        it('com outro ADMIN no espaço, rebaixar e remover passam', async () => {
            await platform.patch(`/users/${memberId}/profile`, { profile: 'ADMIN' });

            const demoted = await platform.patch(`/users/${adminId}/profile`, {
                profile: 'VIEWER',
            });
            expect(demoted.status).toBe(200);

            const removed = await platform.delete(`/users/${adminId}/profile`);
            expect(removed.status).toBe(200);
        });

        it('remover o único membro de um espaço não é recusado', async () => {
            await platform.delete(`/users/${memberId}/profile`);

            const response = await platform.delete(`/users/${adminId}/profile`);

            expect(response.status).toBe(200);
        });
    });

    describe('rotas de espaço (AC-0021-09)', () => {
        it('GET /workspaces lista com memberCount, ordenado por nome', async () => {
            const a = await pending('uid-a');
            const workspaceId = (await approveInNewWorkspace(a, 'Casa')).body.data.workspace
                .id as string;
            const b = await pending('uid-b');
            await platform.patch(`/users/${b}/profile`, { profile: 'VIEWER', workspaceId });
            const c = await pending('uid-c');
            await approveInNewWorkspace(c, 'Alfa');

            const response = await platform.get('/workspaces');

            expect(response.status).toBe(200);
            const names = (response.body.data as { name: string }[]).map((w) => w.name);
            expect(names).toEqual([...names].sort());
            expect(response.body.data).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'Casa', memberCount: 2 }),
                    expect.objectContaining({ name: 'Alfa', memberCount: 1 }),
                ]),
            );
            expect(Object.keys(response.body.data[0]).sort()).toEqual([
                'createdAt',
                'id',
                'memberCount',
                'name',
            ]);
        });

        it('PATCH /workspaces/:id renomeia', async () => {
            const a = await pending('uid-a');
            const workspaceId = (await approveInNewWorkspace(a, 'Casa')).body.data.workspace
                .id as string;

            const response = await platform.patch(`/workspaces/${workspaceId}`, { name: 'Lar' });

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({
                id: workspaceId,
                name: 'Lar',
                memberCount: 1,
            });
        });

        it('membro ADMIN que não é admin da plataforma recebe 403 nas duas e em GET /users (ERR-0021-04)', async () => {
            const a = await pending('uid-a');
            const workspaceId = (await approveInNewWorkspace(a, 'Casa')).body.data.workspace
                .id as string;
            const member = as('Bearer uid-a');

            for (const response of [
                await member.get('/workspaces'),
                await member.patch(`/workspaces/${workspaceId}`, { name: 'X' }),
                await member.get('/users'),
                await member.patch(`/users/${platformId}/profile`, { profile: 'VIEWER' }),
                await member.delete(`/users/${platformId}/profile`),
            ]) {
                expect(response.status).toBe(403);
                expect(response.body.error.code).toBe('FORBIDDEN');
            }
        });

        it('usuário pendente também recebe 403 FORBIDDEN nas rotas de plataforma (ERR-0021-04)', async () => {
            await pending('uid-novo');

            const response = await as('Bearer uid-novo').get('/workspaces');

            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe('FORBIDDEN');
        });

        it('PATCH /workspaces/:id inexistente responde 404 WORKSPACE_NOT_FOUND (ERR-0021-12)', async () => {
            const response = await platform.patch(
                '/workspaces/00000000-0000-4000-8000-000000000000',
                { name: 'X' },
            );

            expect(response.status).toBe(404);
            expect(response.body.error.code).toBe('WORKSPACE_NOT_FOUND');
        });
    });

    describe('erros da aprovação (ERR-0021-03 a ERR-0021-11)', () => {
        it('usuário sem espaço em rota de domínio recebe 403 PROFILE_PENDING (ERR-0021-03)', async () => {
            await pending('uid-novo');

            const response = await as('Bearer uid-novo').get('/bank-accounts');

            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe('PROFILE_PENDING');
        });

        it('workspaceId inexistente responde 404 WORKSPACE_NOT_FOUND (ERR-0021-05)', async () => {
            const id = await pending('uid-novo');

            const response = await platform.patch(`/users/${id}/profile`, {
                profile: 'VIEWER',
                workspaceId: '00000000-0000-4000-8000-000000000000',
            });

            expect(response.status).toBe(404);
            expect(response.body.error.code).toBe('WORKSPACE_NOT_FOUND');
            await expect(ctx.findByUid('uid-novo')).resolves.toMatchObject({ membership: null });
        });

        it('newWorkspace com perfil que não é ADMIN responde 400 citando profile (ERR-0021-06)', async () => {
            const id = await pending('uid-novo');

            const response = await platform.patch(`/users/${id}/profile`, {
                profile: 'VIEWER',
                newWorkspace: { name: 'Casa' },
            });

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('VALIDATION_ERROR');
            expect(JSON.stringify(response.body.error.details)).toContain('profile');
        });

        it('pendente sem workspaceId nem newWorkspace responde 400 (ERR-0021-07)', async () => {
            const id = await pending('uid-novo');

            const response = await platform.patch(`/users/${id}/profile`, { profile: 'VIEWER' });

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('com os dois responde 400 e não cria espaço (ERR-0021-07)', async () => {
            const id = await pending('uid-novo');

            const response = await platform.patch(`/users/${id}/profile`, {
                profile: 'ADMIN',
                workspaceId: '00000000-0000-4000-8000-000000000000',
                newWorkspace: { name: 'Casa' },
            });

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('VALIDATION_ERROR');
            const [{ n }] = (await ctx.dataSource.query(
                "SELECT count(*)::int AS n FROM workspaces WHERE name = 'Casa'",
            )) as [{ n: number }];
            expect(n).toBe(0);
        });

        it('alterar o próprio membro responde 409 CANNOT_CHANGE_OWN_PROFILE (ERR-0021-10)', async () => {
            const patch = await platform.patch(`/users/${platformId}/profile`, {
                profile: 'VIEWER',
            });
            const del = await platform.delete(`/users/${platformId}/profile`);

            for (const response of [patch, del]) {
                expect(response.status).toBe(409);
                expect(response.body.error.code).toBe('CANNOT_CHANGE_OWN_PROFILE');
            }
        });

        it.each(['', '   ', 'x'.repeat(81)])(
            'nome de espaço inválido %p responde 400 citando name (ERR-0021-11)',
            async (name) => {
                const id = await pending('uid-novo');
                const created = await platform.patch(`/users/${id}/profile`, {
                    profile: 'ADMIN',
                    newWorkspace: { name },
                });
                const rename = await platform.patch(
                    '/workspaces/00000000-0000-4000-8000-000000000000',
                    { name },
                );

                for (const response of [created, rename]) {
                    expect(response.status).toBe(400);
                    expect(response.body.error.code).toBe('VALIDATION_ERROR');
                    expect(JSON.stringify(response.body.error.details)).toContain('name');
                }
            },
        );

        it('nome com 80 caracteres é aceito (ERR-0021-11)', async () => {
            const id = await pending('uid-novo');

            const response = await approveInNewWorkspace(id, 'x'.repeat(80));

            expect(response.status).toBe(200);
        });
    });

    describe('usuários e o espaço do contexto (INV-0021-05, INV-0021-02, INV-0021-09)', () => {
        it('GET /users traz espaço e marca de admin da plataforma', async () => {
            const id = await pending('uid-casa');
            await approveInNewWorkspace(id, 'Casa');

            const response = await platform.get('/users');

            expect(response.status).toBe(200);
            const casa = (response.body.data as { email: string }[]).find(
                (user) => user.email === 'uid-casa@exemplo.com',
            );
            expect(casa).toMatchObject({ workspace: { name: 'Casa' }, isPlatformAdmin: false });
        });

        it('o espaço da requisição vem do banco na requisição, não do token (INV-0021-05)', async () => {
            const a = await pending('uid-a');
            const first = (await approveInNewWorkspace(a, 'Casa')).body.data.workspace.id as string;

            await platform.delete(`/users/${a}/profile`);
            const second = (await approveInNewWorkspace(a, 'Outra')).body.data.workspace
                .id as string;

            const me = await as('Bearer uid-a').get('/users/me');

            expect(me.body.data.workspace.id).toBe(second);
            expect(second).not.toBe(first);
        });

        it('um usuário é membro de no máximo um espaço (INV-0021-02)', async () => {
            const a = await pending('uid-a');
            const { workspace } = (await approveInNewWorkspace(a, 'Casa')).body.data as {
                workspace: { id: string };
            };

            await ctx.dataSource.query("INSERT INTO workspaces (name) VALUES ('Outro')");

            await expect(
                ctx.dataSource.query(
                    `INSERT INTO workspace_members (workspace_id, user_id, profile, granted_at)
                     SELECT id, $1, 'VIEWER', now() FROM workspaces WHERE id <> $2 LIMIT 1`,
                    [a, workspace.id],
                ),
            ).rejects.toThrow(/uq_workspace_members_user_id/);
        });

        it('nenhuma rota tira a marca de admin da plataforma (INV-0021-09)', async () => {
            const id = await pending('uid-casa');
            await approveInNewWorkspace(id, 'Casa');
            await markPlatformAdmin('uid-casa');
            await platform.delete(`/users/${id}/profile`);
            await platform.patch(`/users/${id}/profile`, {
                profile: 'VIEWER',
                workspaceId: (await platform.get('/workspaces')).body.data[0].id,
            });

            const stored = await ctx.findByUid('uid-casa');
            expect(stored?.isPlatformAdmin).toBe(true);
        });
    });

    describe('bootstrap do admin da plataforma (AC-0021-10)', () => {
        const env: IEnvService = {
            getEnv: (key: string) =>
                (key === 'IDENTITY_BOOTSTRAP_ADMIN_EMAIL' ? 'boot@exemplo.com' : '') as string,
        };
        const provisioning = () => new UserProvisioningService(ctx.dataSource, env);
        const token = {
            uid: 'uid-boot',
            email: 'boot@exemplo.com',
            emailVerified: true,
            name: 'Boot',
        };

        it('cria o usuário como admin da plataforma e ADMIN de um espaço com o nome dele; repetir não muda nada', async () => {
            const first = await provisioning().provision(token);

            expect(first.isPlatformAdmin).toBe(true);
            expect(first.membership).toMatchObject({ profile: 'ADMIN', grantedById: null });

            const before = await ctx.dataSource.query(
                'SELECT id, name FROM workspaces WHERE id = $1',
                [first.membership!.workspaceId],
            );
            expect(before[0].name).toBe('Boot');

            const again = await provisioning().provision(token);

            expect(again.membership?.workspaceId).toBe(first.membership!.workspaceId);
            const [{ n }] = (await ctx.dataSource.query(
                "SELECT count(*)::int AS n FROM workspaces WHERE name = 'Boot'",
            )) as [{ n: number }];
            expect(n).toBe(1);
        });

        it('admin da plataforma que já é membro não ganha segundo espaço', async () => {
            await as('Bearer uid-boot~boot@exemplo.com~true').get('/users/me');
            const user = await ctx.setProfile('uid-boot', 'VIEWER');
            const before = await ctx.dataSource.query('SELECT count(*)::int AS n FROM workspaces');

            const result = await provisioning().provision(token);

            expect(result.isPlatformAdmin).toBe(true);
            expect(result.membership).toMatchObject({
                workspaceId: user.membership!.workspaceId,
                profile: 'VIEWER',
            });
            const after = await ctx.dataSource.query('SELECT count(*)::int AS n FROM workspaces');
            expect(before[0].n).toBe(1);
            expect(after[0].n).toBe(1);
        });
    });
});
