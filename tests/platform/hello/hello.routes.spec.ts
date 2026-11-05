import 'reflect-metadata';
import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../../integration/app.helper';

const SCHEMA = 'test_platform_hello';

describe('GET /hello (spec 0022)', () => {
    let ctx: TestApp;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    it('responde 200 sem Authorization com o envelope padrão (AC-0022-01)', async () => {
        const response = await request(ctx.app).get('/hello');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ data: { message: 'hello world' } });
    });

    it('tem Content-Type JSON e x-correlation-id (AC-0022-02)', async () => {
        const response = await request(ctx.app).get('/hello');

        expect(response.headers['content-type']).toMatch(/application\/json/);
        expect(response.headers['x-correlation-id']).toBeDefined();
    });

    it('ignora credencial: mesma resposta com e sem Authorization (INV-0022-01)', async () => {
        const anon = await request(ctx.app).get('/hello');
        const authed = await request(ctx.app).get('/hello').set('Authorization', 'Bearer invalido');

        expect(authed.status).toBe(200);
        expect(authed.body).toEqual(anon.body);
    });

    it('responde 404 ROUTE_NOT_FOUND para POST (AC-0022-03, ERR-0022-01)', async () => {
        const response = await request(ctx.app).post('/hello');

        expect(response.status).toBe(404);
        expect(response.body.error).toMatchObject({ code: 'ROUTE_NOT_FOUND' });
    });
});

describe('GET /hello/:name (spec 0023)', () => {
    let ctx: TestApp;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA + '_name');
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA + '_name');
    });

    it('cumprimenta sem Authorization (AC-0023-01, INV-0023-01)', async () => {
        const anon = await request(ctx.app).get('/hello/Maria');
        const authed = await request(ctx.app).get('/hello/Maria').set('Authorization', 'Bearer x');

        expect(anon.status).toBe(200);
        expect(anon.body).toEqual({ data: { message: 'hello Maria' } });
        expect(authed.body).toEqual(anon.body);
    });

    it.each([
        ['/hello/Jos%C3%A9', 'hello José'],
        ['/hello/Ana-Clara', 'hello Ana-Clara'],
        ['/hello/-', 'hello -'],
    ])('aceita %s (AC-0023-02)', async (path, message) => {
        const response = await request(ctx.app).get(path);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ data: { message } });
    });

    it('aceita 40 letras e rejeita 41 (AC-0023-03, ERR-0023-01)', async () => {
        const ok = await request(ctx.app).get(`/hello/${'a'.repeat(40)}`);
        const bad = await request(ctx.app).get(`/hello/${'a'.repeat(41)}`);

        expect(ok.status).toBe(200);
        expect(bad.status).toBe(400);
        expect(bad.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
        expect(bad.body.error.details[0].path).toEqual(['name']);
    });

    it.each(['/hello/Ana%20Maria', '/hello/Ana2', '/hello/Ana_', '/hello/a.b', '/hello/a@b'])(
        'rejeita %s (AC-0023-04, ERR-0023-02)',
        async (path) => {
            const response = await request(ctx.app).get(path);

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('VALIDATION_ERROR');
            for (const d of response.body.error.details) {
                expect(d).toEqual(
                    expect.objectContaining({
                        path: expect.any(Array),
                        code: expect.any(String),
                        message: expect.any(String),
                    }),
                );
            }
        },
    );

    it('rejeita percent-encoding malformado (AC-0023-05, ERR-0023-03)', async () => {
        const response = await request(ctx.app).get('/hello/%E0%A4%A');

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
        expect(JSON.stringify(response.body)).not.toMatch(/decode/i);
    });

    it('tem Content-Type JSON e x-correlation-id (AC-0023-06)', async () => {
        const response = await request(ctx.app).get('/hello/Maria');

        expect(response.headers['content-type']).toMatch(/application\/json/);
        expect(response.headers['x-correlation-id']).toBeDefined();
    });

    it('POST dá 404 e GET /hello/ segue hello world (AC-0023-07, ERR-0023-04/05)', async () => {
        const post = await request(ctx.app).post('/hello/Maria');
        const root = await request(ctx.app).get('/hello/');

        expect(post.status).toBe(404);
        expect(post.body.error.code).toBe('ROUTE_NOT_FOUND');
        expect(root.body).toEqual({ data: { message: 'hello world' } });
    });
});

describe('GET /hello/:name/upper (spec 0024)', () => {
    let ctx: TestApp;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA + '_upper');
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA + '_upper');
    });

    it('responde em maiúsculas sem Authorization (AC-0024-01, INV-0024-01)', async () => {
        const anon = await request(ctx.app).get('/hello/Maria/upper');
        const authed = await request(ctx.app)
            .get('/hello/Maria/upper')
            .set('Authorization', 'Bearer x');

        expect(anon.status).toBe(200);
        expect(anon.body).toEqual({ data: { message: 'HELLO MARIA' } });
        expect(anon.headers['content-type']).toMatch(/application\/json/);
        expect(anon.headers['x-correlation-id']).toBeDefined();
        expect(authed.body).toEqual(anon.body);
    });

    it.each([
        ['/hello/Jos%C3%A9/upper', 'HELLO JOSÉ'],
        ['/hello/Ana-Clara/upper', 'HELLO ANA-CLARA'],
        ['/hello/-/upper', 'HELLO -'],
    ])('aceita %s (AC-0024-02)', async (path, message) => {
        const response = await request(ctx.app).get(path);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ data: { message } });
    });

    it('aceita 40 letras e rejeita 41 (AC-0024-03, ERR-0024-01)', async () => {
        const ok = await request(ctx.app).get(`/hello/${'a'.repeat(40)}/upper`);
        const bad = await request(ctx.app).get(`/hello/${'a'.repeat(41)}/upper`);

        expect(ok.status).toBe(200);
        expect(bad.status).toBe(400);
        expect(bad.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
        expect(bad.body.error.details[0].path).toEqual(['name']);
    });

    it.each(['/hello/Ana%20Maria/upper', '/hello/Ana2/upper', '/hello/Ana_/upper'])(
        'rejeita %s (AC-0024-04, ERR-0024-02)',
        async (path) => {
            const response = await request(ctx.app).get(path);

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('VALIDATION_ERROR');
            for (const d of response.body.error.details) {
                expect(d).toEqual(
                    expect.objectContaining({
                        path: expect.any(Array),
                        code: expect.any(String),
                        message: expect.any(String),
                    }),
                );
            }
        },
    );

    it('rejeita percent-encoding malformado (AC-0024-04, ERR-0024-03)', async () => {
        const response = await request(ctx.app).get('/hello/%E0%A4%A/upper');

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
        expect(JSON.stringify(response.body)).not.toMatch(/decode/i);
    });

    it('POST dá 404 ROUTE_NOT_FOUND (AC-0024-05, ERR-0024-04)', async () => {
        const post = await request(ctx.app).post('/hello/Maria/upper');

        expect(post.status).toBe(404);
        expect(post.body.error.code).toBe('ROUTE_NOT_FOUND');
    });
});
