import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { DataSource } from 'typeorm';

import { buildDataSourceOptions } from '../../src/platform/database/data-source';

/**
 * Conexão dedicada à suíte de integração: o `AppDataSource` é o singleton do
 * processo da aplicação, e uma suíte que o inicializasse vazaria estado para as
 * demais.
 */
export function createTestDataSource(): DataSource {
    return new DataSource(buildDataSourceOptions());
}

/**
 * Falha com instrução em vez de um stack trace de socket: sem banco, o
 * diagnóstico útil é "suba o banco", não "ECONNREFUSED".
 */
export async function connectOrExplain(dataSource: DataSource): Promise<DataSource> {
    try {
        return await dataSource.initialize();
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);

        throw new Error(
            `teste de integração precisa de um PostgreSQL em DATABASE_URL (${reason}). ` +
                'Suba o banco local com `npm run db:up` ou exporte DATABASE_URL para outra instância.',
        );
    }
}

/**
 * Conexão numa cópia limpa e exclusiva do schema, nomeada pela suíte.
 *
 * O Jest roda suítes em paralelo, e mais de uma delas precisa de um banco vazio
 * para testar migration. Compartilhando `public`, uma derrubaria o schema sob os
 * pés da outra — com um schema por suíte, cada uma tem o banco só para si e o
 * paralelismo continua valendo.
 */
export async function createIsolatedDataSource(schema: string): Promise<DataSource> {
    const options = buildDataSourceOptions();
    const bootstrap = await connectOrExplain(new DataSource(options));

    try {
        await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    } finally {
        await bootstrap.destroy();
    }

    // `schema` sozinho não basta: o TypeORM só o usa para qualificar entidades, e
    // o SQL cru das migrations continuaria caindo em `public`. Quem redireciona
    // de fato é o `search_path` da conexão, passado ao driver `pg`.
    return new DataSource({
        ...options,
        schema,
        extra: { options: `-c search_path=${schema}` },
    }).initialize();
}

/** Derruba o schema da suíte e fecha a conexão. */
export async function dropIsolatedDataSource(
    dataSource: DataSource | undefined,
    schema: string,
): Promise<void> {
    if (!dataSource?.isInitialized) return;

    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.destroy();
}

const execFileAsync = promisify(execFile);

/**
 * Aplica `jobs:migrate` no banco de teste, como o initContainer faz (spec 0017). O
 * schema `pgboss` é compartilhado entre as suítes, então a migração é idempotente
 * e tenta de novo uma vez se outra suíte estiver migrando ao mesmo tempo.
 */
export async function migrateJobsSchema(databaseUrl = process.env.DATABASE_URL): Promise<void> {
    const run = () =>
        execFileAsync('npm', ['run', '--silent', 'jobs:migrate'], {
            env: { ...process.env, DATABASE_URL: databaseUrl },
        });

    try {
        await run();
    } catch {
        await run();
    }
}

/** Nome do espaço que toda app de teste já tem ao subir (spec 0021). */
export const DEFAULT_WORKSPACE_NAME = 'Principal';

/**
 * O id do espaço padrão em SQL, para os fixtures que inserem linha de domínio
 * direto no banco: `workspace_id` é obrigatório (INV-0021-01).
 */
export const DEFAULT_WORKSPACE_SQL = `(SELECT id FROM workspaces WHERE name = '${DEFAULT_WORKSPACE_NAME}')`;

/** Cria o espaço padrão, se ainda não existe, e devolve o id. */
export async function ensureDefaultWorkspace(dataSource: DataSource): Promise<string> {
    const [existing]: { id: string }[] = await dataSource.query(
        'SELECT id FROM workspaces WHERE name = $1',
        [DEFAULT_WORKSPACE_NAME],
    );

    if (existing) return existing.id;

    const [created]: { id: string }[] = await dataSource.query(
        'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
        [DEFAULT_WORKSPACE_NAME],
    );

    return created!.id;
}
