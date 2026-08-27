import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import type { ILogger } from '@bhs-dev/typescript-common-types';

import { createAccessLogMiddleware } from '../../../src/platform/middlewares/access-log.middleware';

describe('accessLog middleware', () => {
    it('loga uma linha por requisição concluída, com duração e correlation-id', () => {
        const logger = { info: jest.fn() } as unknown as ILogger;
        const res = Object.assign(new EventEmitter(), {
            statusCode: 200,
            locals: { correlationId: 'cid-9' },
        }) as unknown as Response;

        const next = jest.fn() as NextFunction;
        createAccessLogMiddleware({ logger })(
            { method: 'GET', originalUrl: '/health' } as Request,
            res,
            next,
        );

        expect(next).toHaveBeenCalled();
        expect(logger.info).not.toHaveBeenCalled();

        (res as unknown as EventEmitter).emit('finish');

        expect(logger.info).toHaveBeenCalledWith(
            'request completed',
            expect.objectContaining({
                method: 'GET',
                path: '/health',
                status: 200,
                correlationId: 'cid-9',
                durationMs: expect.any(Number),
            }),
        );
    });
});
