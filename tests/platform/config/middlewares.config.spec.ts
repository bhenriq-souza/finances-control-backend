import type { RequestHandler } from 'express';

import {
    sortMiddlewares,
    type MiddlewareEntry,
} from '../../../src/platform/config/middlewares.config';

describe('sortMiddlewares', () => {
    const entry = (name: string, order: number, isErrorHandler = false): MiddlewareEntry => ({
        name,
        order,
        handler: (() => undefined) as RequestHandler,
        isErrorHandler,
    });

    it('ordena por order e separa os error handlers', () => {
        const { preRoute, errorHandlers } = sortMiddlewares([
            entry('third', 3),
            entry('error', 99, true),
            entry('first', 1),
        ]);

        expect(preRoute.map((e) => e.name)).toEqual(['first', 'third']);
        expect(errorHandlers.map((e) => e.name)).toEqual(['error']);
    });

    it('não altera o array recebido', () => {
        const entries = [entry('b', 2), entry('a', 1)];
        sortMiddlewares(entries);

        expect(entries.map((e) => e.name)).toEqual(['b', 'a']);
    });
});
