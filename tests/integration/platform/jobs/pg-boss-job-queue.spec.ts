import 'reflect-metadata';
import { PgBoss } from 'pg-boss';
import { Client } from 'pg';

import { BUSINESS_TIME_ZONE } from '../../../../src/platform/business-date';
import { RequestContext } from '../../../../src/platform/context/request-context';
import type { PgBossJobQueue } from '../../../../src/platform/jobs/pg-boss-job-queue';
import { migrateJobsSchema } from '../../database.helper';
import { createCapturingLogger, createJobQueue, uniqueJobName } from './jobs.helper';

const waitFor = async (condition: () => boolean | Promise<boolean>, timeoutMs = 25_000) => {
    const deadline = Date.now() + timeoutMs;

    while (!(await condition())) {
        if (Date.now() > deadline) throw new Error('timed out waiting for condition');
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
};

describe('PgBossJobQueue (banco real)', () => {
    let observer: PgBoss;
    const queues: PgBossJobQueue[] = [];
    const createdNames: string[] = [];

    const newQueue = (...args: Parameters<typeof createJobQueue>) => {
        const queue = createJobQueue(...args);

        queues.push(queue);

        return queue;
    };

    const named = (action: string) => {
        const name = uniqueJobName(action);

        createdNames.push(name);

        return name;
    };

    beforeAll(async () => {
        await migrateJobsSchema();

        observer = new PgBoss({
            connectionString: process.env.DATABASE_URL,
            schema: 'pgboss',
            migrate: false,
            supervise: false,
            schedule: false,
        });
        await observer.start();
    }, 60_000);

    afterAll(async () => {
        await Promise.all(queues.map((queue) => queue.stop()));
        await Promise.all(createdNames.map((name) => observer.deleteQueue(name).catch(() => 0)));
        await observer.stop();
    }, 60_000);

    describe('AC-0017-01 — JOBS_ENABLED', () => {
        it('com `true`, inicia, cria a fila com a política de retentativa e agenda no fuso de negócio', async () => {
            const queue = newQueue();
            const name = named('daily');

            queue.register(name, async () => undefined);
            queue.schedule(name, '0 3 * * *');
            queue.schedule(name, '30 4 * * *'); // agendar de novo substitui

            expect(queue.getStatus()).toBe('down');

            await queue.start();

            expect(queue.getStatus()).toBe('up');

            const created = await observer.getQueue(name);

            expect(created).toMatchObject({
                retryLimit: 3,
                retryDelay: 60,
                retryBackoff: true,
                expireInSeconds: 900,
            });

            const schedules = await observer.getSchedules(name);

            expect(schedules).toHaveLength(1);
            expect(schedules[0]).toMatchObject({
                cron: '30 4 * * *',
                timezone: BUSINESS_TIME_ZONE,
            });
        });

        it('com `true`, executa o handler com o `correlationId` igual ao id do job', async () => {
            const requestContext = new RequestContext();
            const queue = newQueue({}, createCapturingLogger(), requestContext);
            const name = named('echo');
            const seen: {
                id: string;
                attempt: number;
                payload: unknown;
                correlationId?: string;
            }[] = [];

            queue.register(name, async (job) => {
                seen.push({
                    id: job.id,
                    attempt: job.attempt,
                    payload: job.payload,
                    correlationId: requestContext.getCorrelationId(),
                });
            });
            await queue.start();

            const id = await queue.enqueue(name, { entityId: 'abc' });

            await waitFor(() => seen.length === 1);

            expect(seen[0]).toEqual({
                id,
                attempt: 1,
                payload: { entityId: 'abc' },
                correlationId: id,
            });
        });

        it('com `false`, nada é registrado, agendado nem iniciado, e o status é `disabled`', async () => {
            const queue = newQueue({ JOBS_ENABLED: 'false' });
            const name = named('off');

            queue.register(name, async () => undefined);
            queue.schedule(name, '0 3 * * *');
            await queue.start();

            expect(queue.getStatus()).toBe('disabled');
            expect(await observer.getQueue(name)).toBeNull();
            await expect(queue.enqueue(name, {})).rejects.toThrow('not running');
        });

        it('recusa nome fora de `<módulo>.<ação-em-kebab-case>`', () => {
            const queue = newQueue();

            expect(() => queue.register('MarkOverdue', async () => undefined)).toThrow(TypeError);
            expect(() => queue.schedule('expenses.mark_overdue', '0 3 * * *')).toThrow(TypeError);
        });
    });

    describe('AC-0017-02, INV-0017-08, ERR-0017-05 — retentativa e log de falha', () => {
        it('tenta de novo até 3 vezes além da primeira, loga cada falha e marca a última com `exhausted`', async () => {
            const logger = createCapturingLogger();
            const queue = newQueue({}, logger);
            const name = named('always-fails');
            const attempts: number[] = [];

            queue.register(name, async (job) => {
                attempts.push(job.attempt);

                throw new Error('boom');
            });
            await queue.start();

            // A espera de 60 s é o padrão de produção; o teste a encurta na própria fila.
            await observer.updateQueue(name, { retryDelay: 1, retryBackoff: false });

            const id = await queue.enqueue(name, {});

            await waitFor(() => attempts.length === 4);

            expect(attempts).toEqual([1, 2, 3, 4]);

            const failures = logger.entries.filter(
                (entry) => entry.level === 'error' && entry.message === 'job failed',
            );

            expect(failures).toHaveLength(4);
            expect(failures.map((entry) => entry.meta)).toEqual([
                expect.objectContaining({ job: name, jobId: id, attempt: 1, error: 'boom' }),
                expect.objectContaining({ job: name, jobId: id, attempt: 2, error: 'boom' }),
                expect.objectContaining({ job: name, jobId: id, attempt: 3, error: 'boom' }),
                expect.objectContaining({
                    job: name,
                    jobId: id,
                    attempt: 4,
                    error: 'boom',
                    exhausted: true,
                }),
            ]);
            expect(failures.slice(0, 3).some((entry) => 'exhausted' in entry.meta)).toBe(false);
            expect(failures.every((entry) => typeof entry.meta.durationMs === 'number')).toBe(true);

            const [job] = await observer.findJobs(name, { id });

            expect(job?.state).toBe('failed');
        }, 40_000);

        it('loga início e fim em `info` com `job`, `jobId`, `attempt` e `durationMs`', async () => {
            const logger = createCapturingLogger();
            const queue = newQueue({}, logger);
            const name = named('succeeds');
            let done = false;

            queue.register(name, async () => {
                done = true;
            });
            await queue.start();

            const id = await queue.enqueue(name, {});

            await waitFor(() =>
                logger.entries.some((entry) => entry.message === 'job finished' && done),
            );

            const started = logger.entries.find((entry) => entry.message === 'job started');
            const finished = logger.entries.find((entry) => entry.message === 'job finished');

            expect(started).toMatchObject({
                level: 'info',
                meta: { job: name, jobId: id, attempt: 1 },
            });
            expect(finished).toMatchObject({
                level: 'info',
                meta: { job: name, jobId: id, attempt: 1 },
            });
            expect(typeof finished?.meta.durationMs).toBe('number');
        });
    });

    describe('AC-0017-03 — singletonKey', () => {
        it('não cria um segundo job com a mesma chave enquanto o primeiro não terminou', async () => {
            const queue = newQueue();
            const name = named('singleton');
            let release: () => void = () => undefined;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            let started = false;

            queue.register(name, async () => {
                started = true;
                await gate;
            });
            await queue.start();

            const first = await queue.enqueue(name, { n: 1 }, { singletonKey: 'k1' });

            await waitFor(() => started); // o primeiro está ativo, ainda não terminou

            const second = await queue.enqueue(name, { n: 2 }, { singletonKey: 'k1' });
            const other = await queue.enqueue(name, { n: 3 }, { singletonKey: 'k2' });

            expect(second).toBe(first);
            expect(other).not.toBe(first);

            const jobsOfK1 = await observer.findJobs(name, { key: 'k1' });

            expect(jobsOfK1).toHaveLength(1);

            release();
            await waitFor(
                async () =>
                    (await observer.findJobs(name, { id: first }))[0]?.state === 'completed',
            );

            // Terminado o primeiro, a mesma chave volta a enfileirar.
            const third = await queue.enqueue(name, { n: 4 }, { singletonKey: 'k1' });

            expect(third).not.toBe(first);
        });
    });

    describe('ERR-0017-06, INV-0017-09 — início sem schema', () => {
        it('com o schema `pgboss` ausente, não inicia e não cria o schema', async () => {
            const database = `jobs_empty_${Date.now()}`;
            const emptyUrl = new URL(process.env.DATABASE_URL ?? '');

            emptyUrl.pathname = `/${database}`;

            const admin = new Client({ connectionString: process.env.DATABASE_URL });

            await admin.connect();
            await admin.query(`CREATE DATABASE "${database}"`);

            const queue = newQueue({ DATABASE_URL: emptyUrl.toString() });

            try {
                queue.register(named('never'), async () => undefined);
                await queue.start();

                expect(queue.getStatus()).toBe('down');

                const probe = new Client({ connectionString: emptyUrl.toString() });

                await probe.connect();

                const { rowCount } = await probe.query(
                    'SELECT 1 FROM information_schema.schemata WHERE schema_name = $1',
                    ['pgboss'],
                );

                await probe.end();

                expect(rowCount).toBe(0);
            } finally {
                await queue.stop();
                await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
                await admin.end();
            }
        }, 30_000);
    });
});
