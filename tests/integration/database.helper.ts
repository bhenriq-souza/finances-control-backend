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
