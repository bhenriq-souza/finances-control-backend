import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_earnings_types';
const ADMIN = 'Bearer uid-admin';
const BILLER = 'Bearer uid-biller';
const VIEWER = 'Bearer uid-viewer';

describe('rotas de /earning-types (spec 0014)', () => {
    let ctx: TestApp;

    const create = (name: unknown, auth = ADMIN) =>
        request(ctx.app).post('/earning-types').set('Authorization', auth).send({ name });
    const list = (query = '', auth = ADMIN) =>
        request(ctx.app).get(`/earning-types${query}`).set('Authorization', auth);
    const archive = (id: string, auth = ADMIN) =>
        request(ctx.app).post(`/earning-types/${id}/archive`).set('Authorization', auth);

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        for (const [uid, profile] of [
            ['uid-admin', 'ADMIN'],
            ['uid-biller', 'BILLER'],
            ['uid-viewer', 'VIEWER'],
        ] as const) {
            await request(ctx.app).get('/users/me').set('Authorization', `Bearer ${uid}`);
            await ctx.setProfile(uid, profile);
        }
    });

    afterEach(async () => {
        await ctx.dataSource.query("DELETE FROM earning_types WHERE name LIKE 'Teste%'");
    });

    describe('AC-0014-02', () => {
        it('cria e devolve 201 com o corpo previsto', async () => {
            const response = await create('Teste Freelance');

            expect(response.status).toBe(201);
            expect(Object.keys(response.body.data)).toEqual([
                'id',
                'name',
                'archivedAt',
                'createdAt',
            ]);
            expect(response.body.data).toMatchObject({ name: 'Teste Freelance', archivedAt: null });
        });

        it('recusa nome vazio com 400', async () => {
            const response = await create('   ');

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('altera o nome por PATCH e responde 404 para id inexistente', async () => {
            const { id } = (await create('Teste Antigo')).body.data;

            const ok = await request(ctx.app)
                .patch(`/earning-types/${id}`)
                .set('Authorization', BILLER)
                .send({ name: 'Teste Novo' });
            const missing = await request(ctx.app)
                .patch('/earning-types/00000000-0000-4000-8000-000000000000')
                .set('Authorization', BILLER)
                .send({ name: 'Teste X' });

            expect(ok.status).toBe(200);
            expect(ok.body.data.name).toBe('Teste Novo');
            expect(missing.status).toBe(404);
            expect(missing.body.error.code).toBe('EARNING_TYPE_NOT_FOUND');
        });

        it('arquivar esconde da listagem e ?archived=true mostra', async () => {
            const { id } = (await create('Teste Arquivável')).body.data;

            await archive(id);

            const hidden = await list();
            const shown = await list('?archived=true');

            expect(hidden.body.data.map((t: { id: string }) => t.id)).not.toContain(id);
            const found = shown.body.data.find((t: { id: string }) => t.id === id);
            expect(found.archivedAt).not.toBeNull();
        });

        it('desarquivar devolve o tipo à listagem', async () => {
            const { id } = (await create('Teste Volta')).body.data;
            await archive(id);

            const response = await request(ctx.app)
                .delete(`/earning-types/${id}/archive`)
                .set('Authorization', ADMIN);

            expect(response.status).toBe(200);
            expect(response.body.data.archivedAt).toBeNull();
            expect((await list()).body.data.map((t: { id: string }) => t.id)).toContain(id);
        });

        it('lista as oito pré-definidas por padrão', async () => {
            const response = await list();

            expect(response.status).toBe(200);
            expect(response.body.data).toHaveLength(8);
        });
    });

    describe('ERR-0014-01', () => {
        it.each(['Teste Duplicado', 'TESTE DUPLICADO', 'teste duplicado'])(
            'recusa o nome repetido %p com 409',
            async (name) => {
                await create('Teste Duplicado');

                const response = await create(name);

                expect(response.status).toBe(409);
                expect(response.body.error.code).toBe('EARNING_TYPE_ALREADY_EXISTS');
            },
        );

        it('recusa renomear para nome existente', async () => {
            await create('Teste Um');
            const { id } = (await create('Teste Dois')).body.data;

            const response = await request(ctx.app)
                .patch(`/earning-types/${id}`)
                .set('Authorization', ADMIN)
                .send({ name: 'teste um' });

            expect(response.status).toBe(409);
            expect(response.body.error.code).toBe('EARNING_TYPE_ALREADY_EXISTS');
        });
    });

    describe('ERR-0014-14', () => {
        it('arquivar duas vezes responde 200 nas duas, sem alterar archivedAt', async () => {
            const { id } = (await create('Teste Idempotente')).body.data;

            const first = await archive(id);
            const second = await archive(id);

            expect(first.status).toBe(200);
            expect(second.status).toBe(200);
            expect(second.body.data.archivedAt).toBe(first.body.data.archivedAt);
        });
    });

    describe('ERR-0014-06', () => {
        it('tipo arquivado fica gravado como arquivado', async () => {
            // A recusa de receita nova em tipo arquivado é de POST /earnings (T-0014-03);
            // aqui se garante o estado que a sustenta.
            const { id } = (await create('Teste Encerrado')).body.data;
            await archive(id);

            const rows = await ctx.dataSource.query(
                'SELECT archived_at FROM earning_types WHERE id = $1',
                [id],
            );

            expect(rows[0].archived_at).not.toBeNull();
        });
    });

    describe('perfis (spec 0014, Quem pode o quê)', () => {
        it('BILLER escreve', async () => {
            expect((await create('Teste Biller', BILLER)).status).toBe(201);
        });

        it('VIEWER lista e recebe 403 FORBIDDEN em toda escrita', async () => {
            const { id } = (await create('Teste Viewer')).body.data;

            expect((await list('', VIEWER)).status).toBe(200);

            const attempts = [
                create('Teste V2', VIEWER),
                request(ctx.app)
                    .patch(`/earning-types/${id}`)
                    .set('Authorization', VIEWER)
                    .send({ name: 'Teste V3' }),
                archive(id, VIEWER),
                request(ctx.app)
                    .delete(`/earning-types/${id}/archive`)
                    .set('Authorization', VIEWER),
            ];

            for (const response of await Promise.all(attempts)) {
                expect(response.status).toBe(403);
                expect(response.body.error.code).toBe('FORBIDDEN');
            }
        });

        it('sem perfil, 403 PROFILE_PENDING', async () => {
            const response = await list('', 'Bearer uid-pending');

            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe('PROFILE_PENDING');
        });
    });
});
