import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';

import type { RequestContext } from '../context/request-context';

/** Abre o AsyncLocalStorage da requisição; tudo abaixo enxerga o correlation-id. */
export function createRequestContextMiddleware(deps: {
    requestContext: RequestContext;
}): RequestHandler {
    return (_req, res, next) => {
        const correlationId = (res.locals.correlationId as string | undefined) ?? randomUUID();
        deps.requestContext.run({ correlationId, startedAt: Date.now() }, () => next());
    };
}
