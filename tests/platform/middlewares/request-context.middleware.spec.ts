import 'reflect-metadata';
import type { NextFunction, Request, Response } from 'express';

import { RequestContext } from '../../../src/platform/context/request-context';
import { createRequestContextMiddleware } from '../../../src/platform/middlewares/request-context.middleware';

describe('requestContext middleware', () => {
    it('expõe o correlation-id do response para a cadeia abaixo', () => {
        const requestContext = new RequestContext();
        const res = { locals: { correlationId: 'cid-42' } } as unknown as Response;

        let seen: string | undefined;
        const next = (() => {
            seen = requestContext.getCorrelationId();
        }) as NextFunction;

        createRequestContextMiddleware({ requestContext })({} as Request, res, next);

        expect(seen).toBe('cid-42');
    });

    it('gera um id quando o response ainda não tem um', () => {
        const requestContext = new RequestContext();
        const res = { locals: {} } as unknown as Response;

        let seen: string | undefined;
        const next = (() => {
            seen = requestContext.getCorrelationId();
        }) as NextFunction;

        createRequestContextMiddleware({ requestContext })({} as Request, res, next);

        expect(seen).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('não vaza contexto para fora da requisição', () => {
        const requestContext = new RequestContext();

        expect(requestContext.get()).toBeUndefined();
        expect(requestContext.getCorrelationId()).toBeUndefined();
    });
});
