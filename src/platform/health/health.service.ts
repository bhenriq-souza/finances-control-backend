import { inject, injectable } from 'tsyringe';
import type { IEnvService } from '@bhs-dev/typescript-common-types';

import { EnvServiceSymbol } from '../symbols';

export type HealthReport = {
    status: 'ok';
    application: string;
    version: string;
    environment: string;
    uptimeSeconds: number;
};

@injectable()
export class HealthService {
    constructor(@inject(EnvServiceSymbol) private readonly env: IEnvService) {}

    /**
     * Liveness apenas: responde se o processo está de pé. Checagens de
     * dependência (banco) entram quando existirem, em endpoint de readiness
     * separado — misturar os dois faz o Kubernetes reiniciar o pod por uma
     * falha que é do banco, não da aplicação.
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
}
