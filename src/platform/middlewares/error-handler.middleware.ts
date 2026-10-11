import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import type { ILogger } from '@bhs-dev/typescript-common-types';

import type { HttpResponsesType } from '../http/http-responses';

const PROTOCOL_ERRORS: Record<string, { status: number; code: string; message: string }> = {
    'entity.parse.failed': {
        status: 400,
        code: 'INVALID_JSON',
        message: 'Request body is not valid JSON',
    },
    'entity.too.large': {
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large',
    },
};

/** Reconhece os erros do body-parser pelo campo `type` que ele põe no erro. */
function toProtocolError(
    err: unknown,
): { type: string; status: number; code: string; message: string } | undefined {
    if (typeof err !== 'object' || err === null) return undefined;

    const type = (err as { type?: unknown }).type;
    if (typeof type !== 'string' || !Object.hasOwn(PROTOCOL_ERRORS, type)) return undefined;

    const known = PROTOCOL_ERRORS[type];
    return known ? { type, ...known } : undefined;
}

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

        const protocolError = toProtocolError(err);

        if (protocolError) {
            // O detalhe do parser (posição, trecho do corpo) fica no log, nunca na resposta.
            deps.logger.warn('protocol error', {
                correlationId,
                type: protocolError.type,
                message: err instanceof Error ? err.message : String(err),
            });
            return deps.httpResponses.fail(res, protocolError.status, protocolError.message, {
                code: protocolError.code,
            });
        }

        deps.logger.error('unhandled error', err instanceof Error ? err : { error: String(err) });
        return deps.httpResponses.fail(res, 500, 'Internal server error', {
            code: 'INTERNAL_ERROR',
            details: { correlationId },
        });
    };
}
