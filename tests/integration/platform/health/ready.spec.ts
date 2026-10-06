import 'reflect-metadata';
import request from 'supertest';

import { Client } from 'pg';

import { App } from '../../../../src/app';
import { container } from '../../../../src/container';
import { AppDataSource } from '../../../../src/platform/database/data-source';
import { RequestContext } from '../../../../src/platform/context/request-context';
import { JobQueueSymbol } from '../../../../src/platform/symbols';
import { PgBossJobQueue } from '../../../../src/platform/jobs/pg-boss-job-queue';
import { migrateJobsSchema } from '../../database.helper';
import { createCapturingLogger } from '../jobs/jobs.helper';

// O `HealthService` é singleton do container: uma só fila, com ambiente mutável, atende
// todos os cenários. `JOBS_ENABLED=false` é o estado inicial, o dos testes que não usam jobs.
const jobsEnv: Record<string, string> = {
    APPLICATION_NAME: 'finances-control-backend',
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    DATABASE_SSL: 'false',
    JOBS_ENABLED: 'false',
};
const jobQueue = new PgBossJobQueue(
    { getEnv: (key: string) => jobsEnv[key] ?? '' },
    createCapturingLogger(),
    new RequestContext(),
);

container.registerInstance(JobQueueSymbol, jobQueue);

describe('GET /health/ready (banco real)', () => {
    const app = new App().build();

    beforeAll(() => migrateJobsSchema(), 60_000);

    afterAll(async () => {
        await jobQueue.stop();
        if (AppDataSource.isInitialized) await AppDataSource.destroy();
    });

    it('responde 200 com o banco no ar (AC-0003-04)', async () => {
        const response = await request(app).get('/health/ready');

        expect(response.status).toBe(200);
        expect(response.body.data).toEqual({
            status: 'ready',
            checks: { database: 'up', jobs: 'disabled' },
        });
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

    describe('checks.jobs (spec 0017)', () => {
        it('responde 200 com `jobs: up` quando o pg-boss iniciou', async () => {
            jobsEnv.JOBS_ENABLED = 'true';
            await jobQueue.start();

            const response = await request(app).get('/health/ready');

            expect(response.status).toBe(200);
            expect(response.body.data).toEqual({
                status: 'ready',
                checks: { database: 'up', jobs: 'up' },
            });
        }, 30_000);

        it('responde 503 NOT_READY com `jobs: down` com o pg-boss parado (AC-0017-05)', async () => {
            await jobQueue.stop();

            const response = await request(app).get('/health/ready');

            expect(response.status).toBe(503);
            expect(response.body.error.code).toBe('NOT_READY');
            expect(response.body.error.details.checks).toEqual({ database: 'up', jobs: 'down' });
        });

        it('responde 503 com `jobs: down` e não cria o schema `pgboss` quando ele não existe (AC-0017-05, ERR-0017-06, INV-0017-09)', async () => {
            const database = `ready_empty_${Date.now()}`;
            const emptyUrl = new URL(process.env.DATABASE_URL ?? '');

            emptyUrl.pathname = `/${database}`;

            const admin = new Client({ connectionString: process.env.DATABASE_URL });

            await admin.connect();
            await admin.query(`CREATE DATABASE "${database}"`);

            try {
                jobsEnv.DATABASE_URL = emptyUrl.toString();
                await jobQueue.start();

                const response = await request(app).get('/health/ready');

                expect(response.status).toBe(503);
                expect(response.body.error.details.checks).toEqual({
                    database: 'up',
                    jobs: 'down',
                });

                const probe = new Client({ connectionString: emptyUrl.toString() });

                await probe.connect();

                const { rowCount } = await probe.query(
                    'SELECT 1 FROM information_schema.schemata WHERE schema_name = $1',
                    ['pgboss'],
                );

                await probe.end();

                expect(rowCount).toBe(0);
            } finally {
                jobsEnv.DATABASE_URL = process.env.DATABASE_URL ?? '';
                await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
                await admin.end();
            }
        }, 30_000);

        it('volta a `disabled` e 200 com `JOBS_ENABLED=false`', async () => {
            jobsEnv.JOBS_ENABLED = 'false';

            const response = await request(app).get('/health/ready');

            expect(response.status).toBe(200);
            expect(response.body.data.checks.jobs).toBe('disabled');
        });
    });
});
