import 'reflect-metadata';
import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../../integration/app.helper';

const SCHEMA = 'test_platform_version';

describe('GET /version (spec 0028)', () => {
    let ctx: TestApp;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    it('responde 200 sem Authorization com a versão (AC-0028-01)', async () => {
        const response = await request(ctx.app).get('/version');
        const health = await request(ctx.app).get('/health');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ data: { version: health.body.data.version } });
    });

    it('version é igual à de /health (INV-0028-03)', async () => {
        const version = await request(ctx.app).get('/version');
        const health = await request(ctx.app).get('/health');

        expect(version.body.data.version).toBe(health.body.data.version);
    });

    it('tem Content-Type JSON e x-correlation-id (AC-0028-02)', async () => {
        const response = await request(ctx.app).get('/version');

        expect(response.headers['content-type']).toMatch(/application\/json/);
        expect(response.headers['x-correlation-id']).toBeDefined();
    });

    it('ignora credencial (INV-0028-01)', async () => {
        const anon = await request(ctx.app).get('/version');
        const authed = await request(ctx.app).get('/version').set('Authorization', 'Bearer x');

        expect(authed.status).toBe(200);
        expect(authed.body).toEqual(anon.body);
    });

    it('responde 404 ROUTE_NOT_FOUND para POST (AC-0028-03, ERR-0028-01)', async () => {
        const response = await request(ctx.app).post('/version');

        expect(response.status).toBe(404);
        expect(response.body.error).toMatchObject({ code: 'ROUTE_NOT_FOUND' });
    });
});
