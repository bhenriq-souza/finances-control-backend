import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Garante um correlation-id por requisição: reaproveita o do cliente quando vem,
 * gera um quando não vem, e sempre devolve no response — é o que permite ligar
 * uma reclamação do usuário à linha de log correspondente no Loki.
 */
export function createCorrelationIdMiddleware(): RequestHandler {
    return (req, res, next) => {
        const incoming = req.header(CORRELATION_ID_HEADER);
        const correlationId = incoming && incoming.trim() !== '' ? incoming : randomUUID();

        res.setHeader(CORRELATION_ID_HEADER, correlationId);
        res.locals.correlationId = correlationId;
        next();
    };
}
