import 'reflect-metadata';
import type { NextFunction, Request, Response } from 'express';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import type { ILogger } from '@bhs-dev/typescript-common-types';

import { RequestContext } from '../../../src/platform/context/request-context';
import type { HttpResponsesType } from '../../../src/platform/http/http-responses';
import { createErrorHandlerMiddleware } from '../../../src/platform/middlewares/error-handler.middleware';

const MEMBER = { workspaceId: 'workspace-id', userProfile: 'ADMIN', isPlatformAdmin: true };
const PENDING = { workspaceId: null, userProfile: null, isPlatformAdmin: false };

describe('RequestContext', () => {
    const context = new RequestContext();
    const store = { correlationId: 'correlation-1', startedAt: 1 };

    it('devolve o correlation-id de dentro da requisição', () => {
        context.run(store, () => {
            expect(context.getCorrelationId()).toBe('correlation-1');
        });
    });

    it('não vaza contexto para fora da requisição', () => {
        context.run(store, () => undefined);

        expect(context.get()).toBeUndefined();
        expect(context.getCorrelationId()).toBeUndefined();
    });

    it('guarda o usuário autenticado, o espaço, o perfil do membro e a marca (spec 0021)', () => {
        context.run({ ...store }, () => {
            context.setUser('user-id', MEMBER);

            expect(context.get()).toMatchObject({
                userId: 'user-id',
                workspaceId: 'workspace-id',
                userProfile: 'ADMIN',
                isPlatformAdmin: true,
            });
        });
    });

    it('aceita usuário sem espaço nem perfil', () => {
        context.run({ ...store }, () => {
            context.setUser('user-id', PENDING);

            expect(context.get()).toMatchObject({ workspaceId: null, userProfile: null });
        });
    });

    it('ignora em silêncio fora da requisição, em vez de estourar', () => {
        expect(() => context.setUser('user-id', MEMBER)).not.toThrow();
        expect(context.get()).toBeUndefined();
    });

    describe('requireWorkspaceId (spec 0021)', () => {
        it('devolve o espaço do contexto', () => {
            context.run({ ...store }, () => {
                context.setUser('user-id', MEMBER);

                expect(context.requireWorkspaceId()).toBe('workspace-id');
            });
        });

        it('ERR-0021-13: sem espaço no contexto, lança 500 WORKSPACE_CONTEXT_MISSING', () => {
            context.run({ ...store }, () => {
                context.setUser('user-id', PENDING);

                expect(() => context.requireWorkspaceId()).toThrow(
                    expect.objectContaining({ status: 500, code: 'WORKSPACE_CONTEXT_MISSING' }),
                );
            });
        });

        it('ERR-0021-13: fora de uma requisição, idem', () => {
            expect(() => context.requireWorkspaceId()).toThrow(
                expect.objectContaining({ status: 500, code: 'WORKSPACE_CONTEXT_MISSING' }),
            );
        });

        it('ERR-0021-13: o erro chega ao cliente como 500 e fica registrado em log', () => {
            const logger = {
                warn: jest.fn(),
                error: jest.fn(),
                info: jest.fn(),
                debug: jest.fn(),
                child: jest.fn(),
            } as unknown as ILogger;
            const httpResponses = { fail: jest.fn() } as unknown as HttpResponsesType;
            const res = { locals: { correlationId: 'cid-1' } } as unknown as Response;
            let error: unknown;

            try {
                context.requireWorkspaceId();
            } catch (thrown) {
                error = thrown;
            }

            expect(error).toBeInstanceOf(CustomError);

            createErrorHandlerMiddleware({ logger, httpResponses })(
                error,
                {} as Request,
                res,
                jest.fn() as NextFunction,
            );

            expect(httpResponses.fail).toHaveBeenCalledWith(
                res,
                500,
                expect.any(String),
                expect.objectContaining({ code: 'WORKSPACE_CONTEXT_MISSING' }),
            );
            expect(logger.warn).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ code: 'WORKSPACE_CONTEXT_MISSING', status: 500 }),
            );
        });
    });
});
