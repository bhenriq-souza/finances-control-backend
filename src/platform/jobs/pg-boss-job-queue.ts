import { PgBoss, type Job } from 'pg-boss';
import { inject, injectable } from 'tsyringe';
import type { IEnvService, ILogger } from '@bhs-dev/typescript-common-types';

import { BUSINESS_TIME_ZONE } from '../business-date';
import { RequestContext } from '../context/request-context';
import type { JsonObject } from '../events/domain-event';
import { EnvServiceSymbol, LoggerServiceSymbol, RequestContextSymbol } from '../symbols';
import {
    JOB_NAME_PATTERN,
    type JobHandler,
    type JobQueue,
    type JobsLifecycle,
    type JobsStatus,
} from './job-queue';

/** Schema próprio do pg-boss; criado e migrado só por `jobs:migrate` (INV-0017-09). */
export const PGBOSS_SCHEMA = 'pgboss';

/** 3 tentativas além da primeira, com espera exponencial a partir de 60 s; expira em 15 min. */
export const RETRY_LIMIT = 3;
export const RETRY_DELAY_SECONDS = 60;
export const EXPIRE_IN_SECONDS = 15 * 60;

const PENDING_STATES = new Set(['created', 'retry', 'active']);

type AnyHandler = JobHandler<JsonObject>;

type ClaimedJob = Job<JsonObject> & { retryCount: number };

@injectable()
export class PgBossJobQueue implements JobQueue, JobsLifecycle {
    private readonly handlers = new Map<string, AnyHandler>();
    private readonly schedules = new Map<string, string>();
    private boss?: PgBoss;
    private status: Exclude<JobsStatus, 'disabled'>;

    constructor(
        @inject(EnvServiceSymbol) private readonly env: IEnvService,
        @inject(LoggerServiceSymbol) private readonly logger: ILogger,
        @inject(RequestContextSymbol) private readonly requestContext: RequestContext,
    ) {
        this.status = 'down';
    }

    register<TPayload extends JsonObject>(name: string, handler: JobHandler<TPayload>): void {
        if (!this.isEnabled()) return;

        this.assertName(name);
        this.handlers.set(name, handler as unknown as AnyHandler);
    }

    schedule(name: string, cron: string): void {
        if (!this.isEnabled()) return;

        this.assertName(name);
        this.schedules.set(name, cron);
    }

    async enqueue<TPayload extends JsonObject>(
        name: string,
        payload: TPayload,
        options?: { singletonKey?: string },
    ): Promise<string> {
        const boss = this.boss;

        if (!boss || this.status !== 'up') {
            throw new Error(`job queue is not running; cannot enqueue "${name}"`);
        }

        const singletonKey = options?.singletonKey;
        const id = await boss.send(name, payload, singletonKey ? { singletonKey } : undefined);

        if (id) return id;

        // `null` = já há um job da mesma chave que não terminou; devolve o id dele.
        const sameKey = singletonKey ? await boss.findJobs(name, { key: singletonKey }) : [];
        const existing = sameKey.find((job) => PENDING_STATES.has(job.state));

        if (!existing) throw new Error(`job "${name}" was not enqueued`);

        return existing.id;
    }

    /**
     * Inicia o pg-boss sem migrar (INV-0017-09). Falha de início não derruba a
     * aplicação: vira `down` no readiness (ERR-0017-06).
     */
    async start(): Promise<void> {
        if (!this.isEnabled() || this.status === 'up') return;

        try {
            const boss = new PgBoss({
                connectionString: this.env.getEnv('DATABASE_URL'),
                ssl: this.env.getEnv('DATABASE_SSL') === 'true' ? true : undefined,
                application_name: `${this.env.getEnv('APPLICATION_NAME')}-jobs`,
                schema: PGBOSS_SCHEMA,
                migrate: false,
                createSchema: false,
            });

            boss.on('error', (error) => {
                this.logger.error('pg-boss error', { error: error.message });
            });

            await boss.start();

            try {
                await this.wire(boss);
            } catch (error) {
                await boss.stop({ graceful: false }).catch(() => undefined);

                throw error;
            }

            this.boss = boss;
            this.status = 'up';
        } catch (error) {
            this.boss = undefined;
            this.status = 'down';
            this.logger.error('job queue failed to start', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    async stop(): Promise<void> {
        const boss = this.boss;

        this.boss = undefined;

        this.status = 'down';

        if (boss) await boss.stop({ graceful: true });
    }

    getStatus(): JobsStatus {
        return this.isEnabled() ? this.status : 'disabled';
    }

    private async wire(boss: PgBoss): Promise<void> {
        const names = new Set([...this.handlers.keys(), ...this.schedules.keys()]);

        for (const name of names) {
            await boss.createQueue(name, {
                // `exclusive`: uma `singletonKey` não duplica enquanto o job não terminou (AC-0017-03).
                policy: 'exclusive',
                retryLimit: RETRY_LIMIT,
                retryDelay: RETRY_DELAY_SECONDS,
                retryBackoff: true,
                expireInSeconds: EXPIRE_IN_SECONDS,
            });
        }

        for (const [name, handler] of this.handlers) {
            await boss.work<JsonObject>(name, { includeMetadata: true }, async (jobs) => {
                for (const job of jobs) {
                    await this.runOne(name, handler, job as ClaimedJob);
                }
            });
        }

        for (const [name, cron] of this.schedules) {
            await boss.schedule(name, cron, null, { tz: BUSINESS_TIME_ZONE });
        }
    }

    private async runOne(name: string, handler: AnyHandler, job: ClaimedJob): Promise<void> {
        const attempt = job.retryCount + 1;
        const meta = { job: name, jobId: job.id, attempt, correlationId: job.id };
        const startedAt = Date.now();

        // `correlationId` = id do job: eventos e logs do handler ficam ligados a ele.
        await this.requestContext.run({ correlationId: job.id, startedAt }, async () => {
            this.logger.info('job started', meta);

            try {
                await handler({ id: job.id, name, payload: job.data, attempt });
                this.logger.info('job finished', { ...meta, durationMs: Date.now() - startedAt });
            } catch (error) {
                this.logger.error('job failed', {
                    ...meta,
                    durationMs: Date.now() - startedAt,
                    error: error instanceof Error ? error.message : String(error),
                    // A última tentativa falhada é distinguível das demais (INV-0017-08).
                    ...(job.retryCount >= RETRY_LIMIT ? { exhausted: true } : {}),
                });

                throw error;
            }
        });
    }

    private isEnabled(): boolean {
        return this.env.getEnv('JOBS_ENABLED') !== 'false';
    }

    private assertName(name: string): void {
        if (!JOB_NAME_PATTERN.test(name)) {
            throw new TypeError(`job name must follow <module>.<kebab-case-action>, got "${name}"`);
        }
    }
}
