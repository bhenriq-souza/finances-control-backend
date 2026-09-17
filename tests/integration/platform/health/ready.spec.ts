import 'reflect-metadata';
import request from 'supertest';

import { App } from '../../../../src/app';
import { AppDataSource } from '../../../../src/platform/database/data-source';

describe('GET /health/ready (banco real)', () => {
    const app = new App().build();

    afterAll(async () => {
        if (AppDataSource.isInitialized) await AppDataSource.destroy();
    });

    it('responde 200 com o banco no ar (AC-0003-04)', async () => {
        const response = await request(app).get('/health/ready');

        expect(response.status).toBe(200);
        expect(response.body.data).toEqual({ status: 'ready', checks: { database: 'up' } });
    });

    it('abre a conexão na própria probe, sem depender do boot (ERR-0003-02)', async () => {
        if (AppDataSource.isInitialized) await AppDataSource.destroy();
        expect(AppDataSource.isInitialized).toBe(false);

        const response = await request(app).get('/health/ready');

        expect(response.status).toBe(200);
        expect(AppDataSource.isInitialized).toBe(true);
    });

    it('mantém GET /health respondendo sem tocar no banco (INV-0003-06)', async () => {
        await AppDataSource.destroy();

        const response = await request(app).get('/health');

        expect(response.status).toBe(200);
        expect(response.body.data.status).toBe('ok');
        expect(AppDataSource.isInitialized).toBe(false);
    });
});
