import { join } from 'node:path';
import { DataSource } from 'typeorm';
import type { DataSourceOptions } from 'typeorm';

/**
 * `PostgresDataSourceOptions` não é reexportado na raiz do pacote; extrair da união
 * pelo discriminante evita um import de caminho interno, que quebra a cada versão.
 */
type PostgresOptions = Extract<DataSourceOptions, { type: 'postgres' }>;

import { SnakeCaseNamingStrategy } from './snake-case.naming-strategy';

/**
 * Raiz do código carregado: `src/` sob ts-node e Jest, `dist/src/` na imagem.
 * Resolver por `__dirname` evita manter dois globs e errar um deles.
 */
const CODE_ROOT = join(__dirname, '..', '..');

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
    if (value === undefined || value === '') return fallback;

    return value.toLowerCase() === 'true';
};

const parsePoolSize = (value: string | undefined, fallback: number): number => {
    if (value === undefined || value === '') return fallback;

    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new TypeError(`DATABASE_POOL_MAX must be a positive integer, received: ${value}`);
    }

    return parsed;
};

/**
 * Lê a configuração de `process.env` em vez do `EnvService` de propósito: este
 * módulo também é carregado pela CLI do TypeORM no initContainer de migration,
 * onde o container de injeção não sobe (ADR local 0001).
 */
export function buildDataSourceOptions(env: NodeJS.ProcessEnv = process.env): PostgresOptions {
    const url = env.DATABASE_URL;

    if (!url) {
        throw new TypeError('DATABASE_URL is required to build the data source');
    }

    return {
        type: 'postgres',
        url,
        ssl: parseBoolean(env.DATABASE_SSL, false),
        poolSize: parsePoolSize(env.DATABASE_POOL_MAX, 10),
        applicationName: env.APPLICATION_NAME ?? 'finances-control-backend',
        // O schema só muda por migration versionada (INV-0003-02), e quem as
        // aplica é o initContainer, nunca a aplicação (INV-0003-04).
        synchronize: false,
        migrationsRun: false,
        namingStrategy: new SnakeCaseNamingStrategy(),
        entities: [join(CODE_ROOT, '**', '*.entity.{ts,js}')],
        migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
        migrationsTableName: 'migrations',
    };
}

/** Conexão única do processo (INV-0003-01). */
export const AppDataSource = new DataSource(buildDataSourceOptions());

/** Idempotente: chamada duas vezes, conecta uma só (AC-0003-03). */
export async function initializeDataSource(
    dataSource: DataSource = AppDataSource,
): Promise<DataSource> {
    if (!dataSource.isInitialized) {
        await dataSource.initialize();
    }

    return dataSource;
}
