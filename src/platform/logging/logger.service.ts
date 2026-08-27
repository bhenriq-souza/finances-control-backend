import { inject, injectable } from 'tsyringe';
import winston from 'winston';

import type { IEnvService, ILogger } from '@bhs-dev/typescript-common-types';
import { EnvServiceSymbol } from '../symbols';

type Meta = Record<string, unknown>;

/** Adapta um logger winston ao contrato ILogger, preservando o contexto do filho. */
class WinstonLogger implements ILogger {
    constructor(private readonly logger: winston.Logger) {}

    child(meta: Meta = {}): ILogger {
        return new WinstonLogger(this.logger.child(meta));
    }

    debug(msg: string, meta?: Meta): void {
        this.logger.debug(msg, meta);
    }

    info(msg: string, meta?: Meta): void {
        this.logger.info(msg, meta);
    }

    warn(msg: string, meta?: Meta): void {
        this.logger.warn(msg, meta);
    }

    error(msg: string, meta?: Meta | Error): void {
        if (meta instanceof Error) {
            this.logger.error(msg, { error: meta.message, stack: meta.stack });
            return;
        }
        this.logger.error(msg, meta);
    }
}

/**
 * Logger estruturado em JSON no stdout — que é tudo o que o cluster precisa:
 * o Alloy coleta stdout dos pods e encaminha para o Loki, sem configuração extra.
 */
@injectable()
export class LoggerService extends WinstonLogger {
    constructor(@inject(EnvServiceSymbol) env: IEnvService) {
        super(
            winston.createLogger({
                level: env.getEnv('LOG_LEVEL'),
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.errors({ stack: true }),
                    winston.format.json(),
                ),
                defaultMeta: {
                    application: env.getEnv('APPLICATION_NAME'),
                    environment: env.getEnv('ENV'),
                },
                transports: [new winston.transports.Console()],
            }),
        );
    }
}
