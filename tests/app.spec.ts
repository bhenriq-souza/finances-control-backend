import 'reflect-metadata';
import request from 'supertest';

import { App } from '../src/app';
import { CORRELATION_ID_HEADER } from '../src/platform/middlewares/correlation-id.middleware';

describe('App (integração HTTP)', () => {
    const app = new App().build();

    it('responde 200 em GET /health com o relatório da aplicação', async () => {
        const response = await request(app).get('/health');

        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({
            status: 'ok',
            application: 'finances-control-backend',
            version: '0.0.0-test',
            environment: 'test',
        });
        expect(typeof response.body.data.uptimeSeconds).toBe('number');
    });

    it('gera um correlation-id quando o cliente não envia', async () => {
        const response = await request(app).get('/health');

        expect(response.headers[CORRELATION_ID_HEADER]).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
    });

    it('preserva o correlation-id enviado pelo cliente', async () => {
        const response = await request(app)
            .get('/health')
            .set(CORRELATION_ID_HEADER, 'correlation-from-client');

        expect(response.headers[CORRELATION_ID_HEADER]).toBe('correlation-from-client');
    });

    it('serve a documentação em /docs', async () => {
        const response = await request(app).get('/docs/').redirects(1);

        expect(response.status).toBe(200);
    });

    it('responde 404 para rota inexistente', async () => {
        const response = await request(app).get('/does-not-exist');

        expect(response.status).toBe(404);
    });

    it('reaproveita a mesma instância do Express entre chamadas de build', () => {
        const builder = new App();
        expect(builder.build()).toBe(builder.build());
    });
});
