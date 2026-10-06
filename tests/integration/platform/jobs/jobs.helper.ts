import { randomBytes } from 'node:crypto';

import type { IEnvService, ILogger } from '@bhs-dev/typescript-common-types';

import { RequestContext } from '../../../../src/platform/context/request-context';
import { PgBossJobQueue } from '../../../../src/platform/jobs/pg-boss-job-queue';

export type LogEntry = { level: 'info' | 'error'; message: string; meta: Record<string, unknown> };

export type CapturingLogger = ILogger & { entries: LogEntry[] };

export function createCapturingLogger(): CapturingLogger {
    const entries: LogEntry[] = [];
    const record = (level: LogEntry['level']) => (message: string, meta?: unknown) => {
        entries.push({ level, message, meta: (meta ?? {}) as Record<string, unknown> });
    };
    const logger = {
        entries,
        info: record('info'),
        error: record('error'),
        warn: () => undefined,
        debug: () => undefined,
        child: () => logger,
    };

    return logger as unknown as CapturingLogger;
}

export function createEnv(overrides: Record<string, string> = {}): IEnvService {
    const values: Record<string, string> = {
        APPLICATION_NAME: 'finances-control-backend',
        DATABASE_URL: process.env.DATABASE_URL ?? '',
        DATABASE_SSL: 'false',
        JOBS_ENABLED: 'true',
        ...overrides,
    };

    return { getEnv: (key: string) => values[key] ?? '' };
}

export function createJobQueue(
    overrides: Record<string, string> = {},
    logger: ILogger = createCapturingLogger(),
    requestContext: RequestContext = new RequestContext(),
): PgBossJobQueue {
    return new PgBossJobQueue(createEnv(overrides), logger, requestContext);
}

/** Nome único por execução: o schema `pgboss` é compartilhado e sobrevive à suíte. */
export const uniqueJobName = (action: string): string =>
    `jobstest.${action}-${randomBytes(4).toString('hex')}`;
