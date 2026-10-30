import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../../integration/app.helper';

const SCHEMA = 'test_platform_protocol_errors';
const ADMIN = 'Bearer uid-admin';

describe('erros de protocolo em JSON (spec 0005)', () => {
    let ctx: TestApp;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    it('responde 400 INVALID_JSON para corpo malformado, sem detalhe do parser (AC-0005-01, ERR-0005-01)', async () => {
        const response = await request(ctx.app)
            .post('/banks')
            .set('Authorization', ADMIN)
            .set('Content-Type', 'application/json')
            .send('{');

        expect(response.status).toBe(400);
        expect(response.headers['content-type']).toMatch(/application\/json/);
        expect(response.body.error).toEqual({
            message: 'Request body is not valid JSON',
            code: 'INVALID_JSON',
        });
        expect(response.text).not.toMatch(/position|token|Unexpected|SyntaxError/i);
    });

    it('responde 413 PAYLOAD_TOO_LARGE acima de 100kb (AC-0005-02, ERR-0005-02)', async () => {
        const response = await request(ctx.app)
            .post('/banks')
            .set('Authorization', ADMIN)
            .set('Content-Type', 'application/json')
            .send(JSON.stringify({ name: 'x'.repeat(101 * 1024) }));

        expect(response.status).toBe(413);
        expect(response.headers['content-type']).toMatch(/application\/json/);
        expect(response.body.error).toEqual({
            message: 'Request body is too large',
            code: 'PAYLOAD_TOO_LARGE',
        });
    });

    it('responde 404 ROUTE_NOT_FOUND em JSON para rota inexistente (AC-0005-03, INV-0005-01, ERR-0005-03)', async () => {
        const response = await request(ctx.app).get('/nao-existe');

        expect(response.status).toBe(404);
        expect(response.headers['content-type']).toMatch(/application\/json/);
        expect(response.body.error).toMatchObject({
            message: 'Route not found',
            code: 'ROUTE_NOT_FOUND',
        });
        expect(response.text).not.toMatch(/<html|Cannot /i);
    });

    it('responde 404 ROUTE_NOT_FOUND em JSON para método não registrado (AC-0005-03, INV-0005-01, ERR-0005-03)', async () => {
        const response = await request(ctx.app).delete('/health');

        expect(response.status).toBe(404);
        expect(response.headers['content-type']).toMatch(/application\/json/);
        expect(response.body.error).toMatchObject({
            message: 'Route not found',
            code: 'ROUTE_NOT_FOUND',
        });
        expect(response.text).not.toMatch(/<html|Cannot /i);
    });

    it('devolve path, code e message em cada item de details (AC-0005-06)', async () => {
        await request(ctx.app).get('/users/me').set('Authorization', ADMIN);
        await ctx.setProfile('uid-admin', 'ADMIN');
        await ctx.dataSource.query(
            'UPDATE users SET is_platform_admin = true WHERE firebase_uid = $1',
            ['uid-admin'],
        );

        const response = await request(ctx.app)
            .post('/banks')
            .set('Authorization', ADMIN)
            .send({ febrabanCode: 'x', name: '' });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
        expect(response.body.error.details.length).toBeGreaterThan(0);
        for (const item of response.body.error.details) {
            expect(Array.isArray(item.path)).toBe(true);
            expect(typeof item.code).toBe('string');
            expect(typeof item.message).toBe('string');
        }
    });
});
