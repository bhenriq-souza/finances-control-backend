import 'reflect-metadata';
import request from 'supertest';

import { App } from '../../../src/app';

describe('redirect de GET /docs', () => {
    const app = new App().build();

    it('com X-Forwarded-Prefix /api responde 301 para /api/docs/ (AC-0005-09)', async () => {
        const response = await request(app).get('/docs').set('X-Forwarded-Prefix', '/api');

        expect(response.status).toBe(301);
        expect(response.headers.location).toBe('/api/docs/');
    });

    it('sem o cabeçalho responde 301 para /docs/ (AC-0005-09)', async () => {
        const response = await request(app).get('/docs');

        expect(response.status).toBe(301);
        expect(response.headers.location).toBe('/docs/');
    });

    it('ignora um prefixo diferente de /api (INV-0005-05, ERR-0005-04)', async () => {
        for (const prefix of ['//example.com', '/api/', '/other', 'https://evil.test']) {
            const response = await request(app).get('/docs').set('X-Forwarded-Prefix', prefix);

            expect(response.status).toBe(301);
            expect(response.headers.location).toBe('/docs/');
        }
    });

    it('mantém a query string no redirect', async () => {
        const response = await request(app).get('/docs?a=1');

        expect(response.headers.location).toBe('/docs/?a=1');
    });

    it('GET /docs/ continua chegando à UI do Swagger, sem redirect', async () => {
        const response = await request(app).get('/docs/').set('X-Forwarded-Prefix', '/api');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toMatch(/html/);
    });
});
