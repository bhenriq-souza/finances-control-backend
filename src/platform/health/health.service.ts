import { inject, injectable } from 'tsyringe';
import type { DataSource } from 'typeorm';
import type { IEnvService, ILogger } from '@bhs-dev/typescript-common-types';

import { RequestContext } from '../context/request-context';
import { initializeDataSource } from '../database/data-source';
import {
    DatabaseConnectionSymbol,
    EnvServiceSymbol,
    LoggerServiceSymbol,
    RequestContextSymbol,
} from '../symbols';

export type HealthReport = {
    status: 'ok';
    application: string;
    version: string;
    environment: string;
    uptimeSeconds: number;
};

export type ReadinessReport = {
    status: 'ready' | 'not-ready';
    checks: { database: 'up' | 'down' };
};

/**
 * Teto da sondagem do banco. Acima disso a probe do Kubernetes já teria a sua
 * própria resposta, e uma conexão pendurada seria contada como "pronto".
 */
const DATABASE_PROBE_TIMEOUT_MS = 2_000;

@injectable()
export class HealthService {
    constructor(
        @inject(EnvServiceSymbol) private readonly env: IEnvService,
        @inject(DatabaseConnectionSymbol) private readonly dataSource: DataSource,
        @inject(LoggerServiceSymbol) private readonly logger: ILogger,
        @inject(RequestContextSymbol) private readonly requestContext: RequestContext,
    ) {}

    /**
     * Liveness apenas: responde se o processo está de pé. Checagem de dependência
     * vive em `getReadiness` — misturar as duas faz o Kubernetes reiniciar o pod
     * por uma falha que é do banco, não da aplicação (INV-0003-06).
     */
    getReport(): HealthReport {
        return {
            status: 'ok',
            application: this.env.getEnv('APPLICATION_NAME'),
            version: this.env.getEnv('APPLICATION_VERSION'),
            environment: this.env.getEnv('ENV'),
            uptimeSeconds: Math.floor(process.uptime()),
        };
    }

    /** Readiness: sem cache, cada chamada sonda o banco de novo (spec 0003). */
    async getReadiness(): Promise<ReadinessReport> {
        const database = (await this.isDatabaseUp()) ? 'up' : 'down';

        return {
            status: database === 'up' ? 'ready' : 'not-ready',
            checks: { database },
        };
    }

    private async isDatabaseUp(): Promise<boolean> {
        try {
            await this.probeDatabase();

            return true;
        } catch (error) {
            this.logger.error('readiness probe failed', {
                correlationId: this.requestContext.getCorrelationId(),
                error: error instanceof Error ? error.message : String(error),
            });

            return false;
        }
    }

    private async probeDatabase(): Promise<void> {
        let timer: NodeJS.Timeout | undefined;

        const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
                () =>
                    reject(
                        new Error(`database probe timed out after ${DATABASE_PROBE_TIMEOUT_MS}ms`),
                    ),
                DATABASE_PROBE_TIMEOUT_MS,
            );
        });

        try {
            await Promise.race([this.selectOne(), timeout]);
        } finally {
            // Sem isto o timer segura o processo (e a suíte) por dois segundos.
            if (timer) clearTimeout(timer);
        }
    }

    /**
     * Reconecta quando necessário: o pod sobe com o banco fora do ar (ERR-0003-02)
     * e é a própria probe que recupera a conexão na tentativa seguinte.
     */
    private async selectOne(): Promise<void> {
        await initializeDataSource(this.dataSource);
        await this.dataSource.query('SELECT 1');
    }
}
