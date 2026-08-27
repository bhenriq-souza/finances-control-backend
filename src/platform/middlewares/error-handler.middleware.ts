import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import type { ILogger } from '@bhs-dev/typescript-common-types';

import type { HttpResponsesType } from '../http/http-responses';

/**
 * Error handler global — o único lugar que traduz exceção em resposta HTTP.
 *
 * Erros não operacionais nunca vazam a mensagem interna: o cliente recebe um
 * texto genérico e o correlation-id, e o detalhe fica no log.
 */
export function createErrorHandlerMiddleware(deps: {
    logger: ILogger;
    httpResponses: HttpResponsesType;
}): ErrorRequestHandler {
    return (err, _req, res, _next) => {
        const correlationId = res.locals.correlationId as string | undefined;

        if (err instanceof ZodError) {
            deps.logger.warn('validation error', { correlationId, issues: err.issues });
            return deps.httpResponses.fail(res, 400, 'Validation error', {
                code: 'VALIDATION_ERROR',
                details: err.issues,
            });
        }

        if (err instanceof CustomError) {
            const message = err.exposeMessage ? err.message : 'Request could not be processed';

            deps.logger.warn('handled error', {
                correlationId,
                code: err.code,
                status: err.status,
                message: err.message,
            });

            return deps.httpResponses.fail(res, err.status, message, {
                code: err.code,
                details: err.details,
            });
        }

        deps.logger.error('unhandled error', err instanceof Error ? err : { error: String(err) });
        return deps.httpResponses.fail(res, 500, 'Internal server error', {
            code: 'INTERNAL_ERROR',
            details: { correlationId },
        });
    };
}
