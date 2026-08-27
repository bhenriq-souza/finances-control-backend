import 'reflect-metadata';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import type { ILogger } from '@bhs-dev/typescript-common-types';

import { createErrorHandlerMiddleware } from '../../../src/platform/middlewares/error-handler.middleware';
import type { HttpResponsesType } from '../../../src/platform/http/http-responses';

describe('errorHandler middleware', () => {
    const logger = {
        warn: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        child: jest.fn(),
    } as unknown as ILogger;

    const httpResponses = { fail: jest.fn() } as unknown as HttpResponsesType;
    const res = { locals: { correlationId: 'cid-1' } } as unknown as Response;
    const next = jest.fn() as NextFunction;

    const handle = (error: unknown) =>
        createErrorHandlerMiddleware({ logger, httpResponses })(error, {} as Request, res, next);

    it('traduz ZodError em 400 com as issues', () => {
        const error = z.object({ name: z.string() }).safeParse({}).error;

        handle(error);

        expect(httpResponses.fail).toHaveBeenCalledWith(
            res,
            400,
            'Validation error',
            expect.objectContaining({ code: 'VALIDATION_ERROR' }),
        );
    });

    it('usa status e código do CustomError e expõe a mensagem quando autorizado', () => {
        handle(
            CustomError.notFound('Bank account not found', 'ACCOUNT_NOT_FOUND', {
                exposeMessage: true,
                details: { id: 7 },
            }),
        );

        expect(httpResponses.fail).toHaveBeenCalledWith(
            res,
            404,
            'Bank account not found',
            expect.objectContaining({ code: 'ACCOUNT_NOT_FOUND', details: { id: 7 } }),
        );
    });

    it('não vaza a mensagem de um CustomError que não autoriza exposição', () => {
        handle(CustomError.forbidden('internal reason', 'FORBIDDEN'));

        expect(httpResponses.fail).toHaveBeenCalledWith(
            res,
            403,
            'Request could not be processed',
            expect.objectContaining({ code: 'FORBIDDEN' }),
        );
    });

    it('responde 500 genérico e loga erro inesperado, devolvendo o correlation-id', () => {
        handle(new Error('boom'));

        expect(logger.error).toHaveBeenCalled();
        expect(httpResponses.fail).toHaveBeenCalledWith(
            res,
            500,
            'Internal server error',
            expect.objectContaining({
                code: 'INTERNAL_ERROR',
                details: { correlationId: 'cid-1' },
            }),
        );
    });

    it('trata rejeição que não é Error', () => {
        handle('just a string');

        expect(logger.error).toHaveBeenCalled();
        expect(httpResponses.fail).toHaveBeenCalledWith(
            res,
            500,
            'Internal server error',
            expect.anything(),
        );
    });
});
