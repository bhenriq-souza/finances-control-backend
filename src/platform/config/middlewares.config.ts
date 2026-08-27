import type { ErrorRequestHandler, RequestHandler } from 'express';

export type MiddlewareEntry = {
    name: string;
    order: number;
    handler: RequestHandler | ErrorRequestHandler;
    isErrorHandler?: boolean;
};

/**
 * Pipeline declarativa: a ordem é dado, não consequência de onde alguém colou
 * um `app.use`. O error handler fica por último por exigência do Express.
 */
export function sortMiddlewares(entries: MiddlewareEntry[]): {
    preRoute: MiddlewareEntry[];
    errorHandlers: MiddlewareEntry[];
} {
    const ordered = [...entries].sort((a, b) => a.order - b.order);

    return {
        preRoute: ordered.filter((entry) => !entry.isErrorHandler),
        errorHandlers: ordered.filter((entry) => entry.isErrorHandler),
    };
}
