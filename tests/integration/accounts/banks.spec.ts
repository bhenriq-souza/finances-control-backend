import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_accounts_banks';
const ADMIN = 'Bearer uid-admin';

describe('rotas de /banks (spec 0011)', () => {
    let ctx: TestApp;

    const createBank = (body: Record<string, unknown>, auth = ADMIN) =>
        request(ctx.app).post('/banks').set('Authorization', auth).send(body);

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        await request(ctx.app).get('/users/me').set('Authorization', ADMIN);
        await ctx.setProfile('uid-admin', 'ADMIN');
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM banks');
    });

    describe('POST /banks (AC-0011-01)', () => {
        it('cria e devolve 201 com o corpo previsto', async () => {
            const response = await createBank({ febrabanCode: '260', name: 'Nu Pagamentos' });

            expect(response.status).toBe(201);
            expect(Object.keys(response.body.data)).toEqual([
                'id',
                'febrabanCode',
                'name',
                'archivedAt',
                'createdAt',
            ]);
            expect(response.body.data).toMatchObject({
                febrabanCode: '260',
                name: 'Nu Pagamentos',
                archivedAt: null,
            });
        });

        it('preserva zeros à esquerda', async () => {
            const response = await createBank({ febrabanCode: '001', name: 'Banco do Brasil' });

            expect(response.body.data.febrabanCode).toBe('001');
        });

        it.each(['26', '2600', '26A', '', ' 260', 260])(
            'recusa o código %p com 400 (ERR-0011-01)',
            async (febrabanCode) => {
                const response = await createBank({ febrabanCode, name: 'Qualquer' });

                expect(response.status).toBe(400);
                expect(response.body.error.code).toBe('VALIDATION_ERROR');
            },
        );

        it('recusa nome vazio', async () => {
            const response = await createBank({ febrabanCode: '260', name: '   ' });

            expect(response.status).toBe(400);
        });

        it('recusa campo desconhecido, citando-o (ERR-0011-11)', async () => {
            const response = await createBank({
                febrabanCode: '260',
                name: 'Nu',
                archivedAt: '2020-01-01',
            });

            expect(response.status).toBe(400);
            expect(JSON.stringify(response.body)).toContain('archivedAt');
        });

        it('recusa código repetido com 409 (ERR-0011-02, AC-0011-02)', async () => {
            await createBank({ febrabanCode: '260', name: 'Nu Pagamentos' });

            const response = await createBank({ febrabanCode: '260', name: 'Outro Nome' });

            expect(response.status).toBe(409);
            expect(response.body.error.code).toBe('BANK_ALREADY_EXISTS');
        });
    });

    describe('GET /banks', () => {
        it('lista ordenado por nome', async () => {
            await createBank({ febrabanCode: '341', name: 'Itaú' });
            await createBank({ febrabanCode: '001', name: 'Banco do Brasil' });
            await createBank({ febrabanCode: '260', name: 'Nu Pagamentos' });

            const response = await request(ctx.app).get('/banks').set('Authorization', ADMIN);

            expect(response.status).toBe(200);
            expect(response.body.data.map((bank: { name: string }) => bank.name)).toEqual([
                'Banco do Brasil',
                'Itaú',
                'Nu Pagamentos',
            ]);
        });

        it('lista vazia quando não há nenhum', async () => {
            const response = await request(ctx.app).get('/banks').set('Authorization', ADMIN);

            expect(response.body.data).toEqual([]);
        });
    });

    describe('PATCH /banks/:id', () => {
        it('altera o nome', async () => {
            const { body } = await createBank({ febrabanCode: '260', name: 'Nu' });

            const response = await request(ctx.app)
                .patch(`/banks/${body.data.id}`)
                .set('Authorization', ADMIN)
                .send({ name: 'Nu Pagamentos' });

            expect(response.status).toBe(200);
            expect(response.body.data.name).toBe('Nu Pagamentos');
            expect(response.body.data.febrabanCode).toBe('260');
        });

        it('recusa alterar o código FEBRABAN (ERR-0011-11)', async () => {
            const { body } = await createBank({ febrabanCode: '260', name: 'Nu' });

            const response = await request(ctx.app)
                .patch(`/banks/${body.data.id}`)
                .set('Authorization', ADMIN)
                .send({ febrabanCode: '341' });

            expect(response.status).toBe(400);
            expect(JSON.stringify(response.body)).toContain('febrabanCode');
        });

        it('responde 404 para banco inexistente (ERR-0011-06)', async () => {
            const response = await request(ctx.app)
                .patch('/banks/00000000-0000-4000-8000-000000000000')
                .set('Authorization', ADMIN)
                .send({ name: 'Fantasma' });

            expect(response.status).toBe(404);
            expect(response.body.error.code).toBe('BANK_NOT_FOUND');
        });

        it('recusa id que não é uuid antes de chegar ao banco', async () => {
            const response = await request(ctx.app)
                .patch('/banks/nao-e-uuid')
                .set('Authorization', ADMIN)
                .send({ name: 'Qualquer' });

            expect(response.status).toBe(400);
        });
    });

    describe('autorização (AC-0011-12, INV-0011-09)', () => {
        beforeEach(async () => {
            await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-comum');
        });

        it.each(['BILLER', 'VIEWER'] as const)('%s lê, mas não escreve', async (profile) => {
            await ctx.setProfile('uid-comum', profile);

            const leitura = await request(ctx.app)
                .get('/banks')
                .set('Authorization', 'Bearer uid-comum');
            expect(leitura.status).toBe(200);

            const escrita = await createBank(
                { febrabanCode: '341', name: 'Itaú' },
                'Bearer uid-comum',
            );
            expect(escrita.status).toBe(403);
            expect(escrita.body.error.code).toBe('FORBIDDEN');
        });

        it('sem perfil, nem lê', async () => {
            await ctx.setProfile('uid-comum', null);

            const response = await request(ctx.app)
                .get('/banks')
                .set('Authorization', 'Bearer uid-comum');

            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe('PROFILE_PENDING');
        });

        it('sem token, nenhuma rota responde (INV-0010-01)', async () => {
            await expect(request(ctx.app).get('/banks')).resolves.toMatchObject({ status: 401 });
            await expect(
                request(ctx.app).post('/banks').send({ febrabanCode: '260', name: 'Nu' }),
            ).resolves.toMatchObject({ status: 401 });
        });
    });
});
