import type { RequestHandler } from 'express';
import type { ILogger } from '@bhs-dev/typescript-common-types';

/**
 * Registra uma linha por requisição concluída, com duração e correlation-id.
 * Loga no evento `finish` para que o status já esteja definido.
 */
export function createAccessLogMiddleware(deps: { logger: ILogger }): RequestHandler {
    return (req, res, next) => {
        const startedAt = process.hrtime.bigint();

        res.on('finish', () => {
            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

            deps.logger.info('request completed', {
                method: req.method,
                path: req.originalUrl,
                status: res.statusCode,
                durationMs: Math.round(durationMs * 100) / 100,
                correlationId: res.locals.correlationId,
            });
        });

        next();
    };
}
