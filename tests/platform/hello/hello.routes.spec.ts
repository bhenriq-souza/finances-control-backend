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
