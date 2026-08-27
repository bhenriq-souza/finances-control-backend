import type { NextFunction, Request, Response } from 'express';

import {
    CORRELATION_ID_HEADER,
    createCorrelationIdMiddleware,
} from '../../../src/platform/middlewares/correlation-id.middleware';

describe('correlationId middleware', () => {
    const buildRes = () => ({ setHeader: jest.fn(), locals: {} }) as unknown as Response;

    it('gera um uuid quando o header não vem', () => {
        const res = buildRes();
        const next = jest.fn() as NextFunction;

        createCorrelationIdMiddleware()(
            { header: () => undefined } as unknown as Request,
            res,
            next,
        );

        expect(res.locals.correlationId).toMatch(/^[0-9a-f-]{36}$/);
        expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, res.locals.correlationId);
        expect(next).toHaveBeenCalled();
    });

    it('reaproveita o header enviado pelo cliente', () => {
        const res = buildRes();

        createCorrelationIdMiddleware()(
            { header: () => 'from-client' } as unknown as Request,
            res,
            jest.fn() as NextFunction,
        );

        expect(res.locals.correlationId).toBe('from-client');
    });

    it('ignora header vazio e gera um novo', () => {
        const res = buildRes();

        createCorrelationIdMiddleware()(
            { header: () => '   ' } as unknown as Request,
            res,
            jest.fn() as NextFunction,
        );

        expect(res.locals.correlationId).not.toBe('   ');
        expect(res.locals.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    });
});
