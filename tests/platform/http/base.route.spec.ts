import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { RouteDef } from '@bhs-dev/typescript-common-types';

import { BaseRoute } from '../../../src/platform/http/base.route';

class TestRoute extends BaseRoute {
    constructor(private readonly defs: RouteDef[]) {
        super();
    }

    routes(): RouteDef[] {
        return this.defs;
    }

    exposeWrapAsync(handler: RequestHandler): RequestHandler {
        return this.wrapAsync(handler);
    }
}

describe('BaseRoute', () => {
    it('registra cada rota declarada no router', () => {
        const handler = jest.fn();
        const middleware = jest.fn();

        const router = new TestRoute([
            { method: 'GET', path: '/a', handler },
            { method: 'POST', path: '/b', middlewares: [middleware], handler },
        ]).getRouter();

        const registered = router.stack
            .filter((layer) => layer.route)
            .map((layer) => layer.route?.path);

        expect(registered).toEqual(['/a', '/b']);
    });

    it('encaminha rejeição de handler async para o next', async () => {
        const failure = new Error('async boom');
        const next = jest.fn() as NextFunction;

        const wrapped = new TestRoute([]).exposeWrapAsync(async () => {
            throw failure;
        });
        wrapped({} as Request, {} as Response, next);

        await new Promise(process.nextTick);
        expect(next).toHaveBeenCalledWith(failure);
    });

    it('não chama next quando o handler resolve', async () => {
        const next = jest.fn() as NextFunction;

        const wrapped = new TestRoute([]).exposeWrapAsync(async () => undefined);
        wrapped({} as Request, {} as Response, next);

        await new Promise(process.nextTick);
        expect(next).not.toHaveBeenCalled();
    });
});
