import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_expenses_types';
const ADMIN = 'Bearer uid-admin';
const BILLER = 'Bearer uid-biller';
const VIEWER = 'Bearer uid-viewer';

describe('tipos de despesa (AC-0012-02)', () => {
    let ctx: TestApp;

    const post = (path: string, body: Record<string, unknown>, auth = ADMIN) =>
        request(ctx.app).post(path).set('Authorization', auth).send(body);
    const get = (path: string, auth = ADMIN) =>
        request(ctx.app).get(path).set('Authorization', auth);
    const patch = (id: string, body: Record<string, unknown>, auth = ADMIN) =>
        request(ctx.app).patch(`/expense-types/${id}`).set('Authorization', auth).send(body);
    const archive = (id: string, auth = ADMIN) =>
        request(ctx.app).post(`/expense-types/${id}/archive`).set('Authorization', auth);
    const unarchive = (id: string, auth = ADMIN) =>
        request(ctx.app).delete(`/expense-types/${id}/archive`).set('Authorization', auth);

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        for (const [auth, uid, profile] of [
            [ADMIN, 'uid-admin', 'ADMIN'],
            [BILLER, 'uid-biller', 'BILLER'],
            [VIEWER, 'uid-viewer', 'VIEWER'],
        ] as const) {
            await request(ctx.app).get('/users/me').set('Authorization', auth);
            await ctx.setProfile(uid, profile);
        }
    });

    afterEach(async () => {
        await ctx.dataSource.query("DELETE FROM expense_types WHERE name LIKE 'T-%'");
    });

    it('cria tipo e devolve 201 com o corpo da spec', async () => {
        const res = await post('/expense-types', { name: 'T-Pets' });

        expect(res.status).toBe(201);
        expect(res.body.data).toEqual({
            id: expect.any(String),
            name: 'T-Pets',
            archivedAt: null,
            createdAt: expect.any(String),
        });
    });

    it('lista os tipos pré-definidos da seed (AC-0012-01)', async () => {
        const res = await get('/expense-types');

        expect(res.status).toBe(200);
        expect(res.body.data.map((t: { name: string }) => t.name)).toContain('Moradia');
    });

    it('nome repetido, inclusive com outra caixa, recebe 409 (ERR-0012-01)', async () => {
        await post('/expense-types', { name: 'T-Pets' });

        for (const name of ['T-Pets', 't-pets', 'T-PETS']) {
            const res = await post('/expense-types', { name });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('EXPENSE_TYPE_ALREADY_EXISTS');
        }
    });

    it('nome repetido contra tipo da seed também recebe 409', async () => {
        const res = await post('/expense-types', { name: 'moradia' });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('EXPENSE_TYPE_ALREADY_EXISTS');
    });

    it('PATCH renomeia e recusa nome repetido com 409', async () => {
        const a = (await post('/expense-types', { name: 'T-A' })).body.data.id;
        await post('/expense-types', { name: 'T-B' });

        const ok = await patch(a, { name: 'T-C' }, BILLER);
        expect(ok.status).toBe(200);
        expect(ok.body.data.name).toBe('T-C');

        const dup = await patch(a, { name: 't-b' });
        expect(dup.status).toBe(409);
        expect(dup.body.error.code).toBe('EXPENSE_TYPE_ALREADY_EXISTS');
    });

    it('PATCH com corpo vazio recebe 400 VALIDATION_ERROR', async () => {
        const id = (await post('/expense-types', { name: 'T-Empty' })).body.data.id;

        const res = await patch(id, {});

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('arquivar esconde da listagem e ?archived=true mostra', async () => {
        const id = (await post('/expense-types', { name: 'T-Old' })).body.data.id;

        const res = await archive(id);
        expect(res.status).toBe(200);
        expect(res.body.data.archivedAt).not.toBeNull();

        const padrao = await get('/expense-types');
        expect(padrao.body.data.map((t: { id: string }) => t.id)).not.toContain(id);

        const todos = await get('/expense-types?archived=true');
        expect(todos.body.data.map((t: { id: string }) => t.id)).toContain(id);
    });

    it('arquivar duas vezes responde 200 nas duas e não reescreve (ERR-0012-16)', async () => {
        const id = (await post('/expense-types', { name: 'T-Twice' })).body.data.id;

        const first = await archive(id);
        const second = await archive(id);

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(second.body.data.archivedAt).toBe(first.body.data.archivedAt);
    });

    it('DELETE /:id/archive desarquiva, idempotente', async () => {
        const id = (await post('/expense-types', { name: 'T-Back' })).body.data.id;
        await archive(id);

        const first = await unarchive(id);
        const second = await unarchive(id);

        expect(first.status).toBe(200);
        expect(first.body.data.archivedAt).toBeNull();
        expect(second.status).toBe(200);
    });

    it('id inexistente recebe 404 EXPENSE_TYPE_NOT_FOUND (ERR-0012-02)', async () => {
        const id = '00000000-0000-4000-8000-000000000000';

        const results = await Promise.all([patch(id, { name: 'T-X' }), archive(id), unarchive(id)]);

        for (const res of results) {
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('EXPENSE_TYPE_NOT_FOUND');
        }
    });

    it('corpo inválido recebe 400', async () => {
        expect((await post('/expense-types', { name: '  ' })).status).toBe(400);
        expect((await post('/expense-types', { name: 'T-X', archivedAt: null })).status).toBe(400);
    });

    it('VIEWER lista e recebe 403 FORBIDDEN em toda escrita (INV-0012-12)', async () => {
        const id = (await post('/expense-types', { name: 'T-V' })).body.data.id;

        expect((await get('/expense-types', VIEWER)).status).toBe(200);

        const writes = await Promise.all([
            post('/expense-types', { name: 'T-W' }, VIEWER),
            patch(id, { name: 'T-Y' }, VIEWER),
            archive(id, VIEWER),
            unarchive(id, VIEWER),
        ]);

        for (const res of writes) {
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('FORBIDDEN');
        }
    });

    it('BILLER escreve; sem perfil recebe 403 PROFILE_PENDING', async () => {
        expect((await post('/expense-types', { name: 'T-Bil' }, BILLER)).status).toBe(201);

        await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-new');
        const res = await get('/expense-types', 'Bearer uid-new');

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('PROFILE_PENDING');
    });
});
