import type { EnvList } from '@bhs-dev/typescript-common-types';

/**
 * Declaração das variáveis de ambiente. O EnvService valida esta lista no boot
 * e falha listando todas as obrigatórias ausentes de uma vez.
 */
export const envList: EnvList = [
    { key: 'APPLICATION_NAME', required: true, description: 'Nome da aplicação nos logs' },
    { key: 'APPLICATION_VERSION', required: true, description: 'Versão exposta em /health' },
    { key: 'ENV', required: true, description: 'Ambiente lógico: local, dev, prd' },
    { key: 'SERVER_PORT', required: true, description: 'Porta HTTP' },
    {
        key: 'DATABASE_URL',
        required: true,
        description: 'Conexão com o PostgreSQL: postgres://user:pass@host:5432/database',
    },
    { key: 'NODE_ENV', required: false, default: 'development' },
    { key: 'LOG_LEVEL', required: false, default: 'info' },
    { key: 'DATABASE_SSL', required: false, default: 'false', description: 'TLS na conexão' },
    {
        key: 'DATABASE_POOL_MAX',
        required: false,
        default: '10',
        description: 'Conexões máximas do pool',
    },
];
