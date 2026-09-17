import 'reflect-metadata';
import type { NextFunction, Request, Response } from 'express';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import type { ILogger } from '@bhs-dev/typescript-common-types';

import { RequestContext } from '../../src/platform/context/request-context';
import { createAuthenticationMiddleware } from '../../src/identity/authentication.middleware';
import {
    AuthUnavailableError,
    ExpiredTokenError,
    InvalidTokenError,
    type TokenVerifier,
} from '../../src/identity/token-verifier';
import type { UserProvisioningService } from '../../src/identity/user-provisioning.service';
import type { User } from '../../src/identity/user.entity';

const ID_TOKEN = 'eyJhbGciOiJSUzI1NiIsImtpZCI6InNlZ3JlZG8ifQ.payload.signature';

type Deps = Parameters<typeof createAuthenticationMiddleware>[0];

const build = (overrides: Partial<Deps> = {}) => {
    const logger = {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        child: jest.fn(),
    } as unknown as ILogger;

    const deps: Deps = {
        tokenVerifier: {
            verify: jest.fn().mockResolvedValue({ uid: 'uid', email: 'a@b.com', name: 'A' }),
        } as unknown as TokenVerifier,
        provisioning: {
            provision: jest.fn().mockResolvedValue({ id: 'user-id', profile: 'VIEWER' } as User),
        } as unknown as UserProvisioningService,
        requestContext: new RequestContext(),
        logger,
        ...overrides,
    };

    return { deps, logger, middleware: createAuthenticationMiddleware(deps) };
};

/** Roda o middleware dentro de um contexto de requisição e devolve o que aconteceu. */
const run = async (
    middleware: ReturnType<typeof createAuthenticationMiddleware>,
    requestContext: RequestContext,
    header?: string,
) => {
    const req = { header: () => header } as unknown as Request;

    return new Promise<{ error: unknown; store: ReturnType<RequestContext['get']> }>((resolve) => {
        requestContext.run({ correlationId: 'correlation-1', startedAt: Date.now() }, () => {
            const next: NextFunction = (error?: unknown) =>
                resolve({ error, store: requestContext.get() });

            middleware(req, {} as Response, next);
        });
    });
};

describe('requireAuthentication', () => {
    describe('header ausente ou malformado (ERR-0010-01)', () => {
        it.each([
            ['sem header', undefined],
            ['vazio', ''],
            ['sem o esquema', ID_TOKEN],
            ['esquema errado', `Basic ${ID_TOKEN}`],
            ['Bearer sem token', 'Bearer '],
        ])('recusa %s com 401 UNAUTHENTICATED', async (_caso, header) => {
            const { deps, middleware } = build();

            const { error } = await run(middleware, deps.requestContext, header);

            expect(error).toBeInstanceOf(CustomError);
            expect(error).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
        });

        it('não chega a verificar token nenhum', async () => {
            const { deps, middleware } = build();

            await run(middleware, deps.requestContext, undefined);

            expect(deps.tokenVerifier.verify).not.toHaveBeenCalled();
        });
    });

    describe('token recusado', () => {
        it('inválido responde 401 UNAUTHENTICATED (ERR-0010-02)', async () => {
            const { deps, middleware } = build({
                tokenVerifier: {
                    verify: jest.fn().mockRejectedValue(new InvalidTokenError('kid desconhecido')),
                } as unknown as TokenVerifier,
            });

            const { error } = await run(middleware, deps.requestContext, `Bearer ${ID_TOKEN}`);

            expect(error).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
        });

        it('expirado responde 401 TOKEN_EXPIRED (ERR-0010-03)', async () => {
            const { deps, middleware } = build({
                tokenVerifier: {
                    verify: jest.fn().mockRejectedValue(new ExpiredTokenError('expirou')),
                } as unknown as TokenVerifier,
            });

            const { error } = await run(middleware, deps.requestContext, `Bearer ${ID_TOKEN}`);

            expect(error).toMatchObject({ status: 401, code: 'TOKEN_EXPIRED' });
        });

        it('provedor fora do ar responde 503, não 401 (ERR-0010-10)', async () => {
            const { deps, middleware } = build({
                tokenVerifier: {
                    verify: jest.fn().mockRejectedValue(new AuthUnavailableError('ECONNRESET')),
                } as unknown as TokenVerifier,
            });

            const { error } = await run(middleware, deps.requestContext, `Bearer ${ID_TOKEN}`);

            expect(error).toMatchObject({ status: 503, code: 'AUTH_UNAVAILABLE' });
        });

        it('erro inesperado sobe como veio', async () => {
            const boom = new Error('boom');
            const { deps, middleware } = build({
                tokenVerifier: {
                    verify: jest.fn().mockRejectedValue(boom),
                } as unknown as TokenVerifier,
            });

            const { error } = await run(middleware, deps.requestContext, `Bearer ${ID_TOKEN}`);

            expect(error).toBe(boom);
        });
    });

    describe('token aceito', () => {
        it('provisiona o usuário e o deixa no contexto', async () => {
            const { deps, middleware } = build();

            const { error, store } = await run(
                middleware,
                deps.requestContext,
                `Bearer ${ID_TOKEN}`,
            );

            expect(error).toBeUndefined();
            expect(deps.provisioning.provision).toHaveBeenCalledWith({
                uid: 'uid',
                email: 'a@b.com',
                name: 'A',
            });
            expect(store).toMatchObject({ userId: 'user-id', userProfile: 'VIEWER' });
        });

        it('usuário sem perfil também passa pela autenticação (INV-0010-03)', async () => {
            const { deps, middleware } = build({
                provisioning: {
                    provision: jest
                        .fn()
                        .mockResolvedValue({ id: 'pendente', profile: null } as User),
                } as unknown as UserProvisioningService,
            });

            const { error, store } = await run(
                middleware,
                deps.requestContext,
                `Bearer ${ID_TOKEN}`,
            );

            expect(error).toBeUndefined();
            expect(store).toMatchObject({ userId: 'pendente', userProfile: null });
        });

        it('aceita token com espaços em volta', async () => {
            const { deps, middleware } = build();

            const { error } = await run(middleware, deps.requestContext, `Bearer  ${ID_TOKEN}  `);

            expect(error).toBeUndefined();
            expect(deps.tokenVerifier.verify).toHaveBeenCalledWith(ID_TOKEN);
        });
    });

    describe('o que vai para o log (INV-0010-09)', () => {
        it('registra o motivo e o correlation-id, jamais o token', async () => {
            const { deps, logger, middleware } = build({
                tokenVerifier: {
                    verify: jest.fn().mockRejectedValue(new InvalidTokenError('kid desconhecido')),
                } as unknown as TokenVerifier,
            });

            await run(middleware, deps.requestContext, `Bearer ${ID_TOKEN}`);

            expect(logger.warn).toHaveBeenCalledWith('rejected id token', {
                correlationId: 'correlation-1',
                reason: 'kid desconhecido',
            });

            const logged = JSON.stringify([
                (logger.warn as jest.Mock).mock.calls,
                (logger.error as jest.Mock).mock.calls,
            ]);
            expect(logged).not.toContain(ID_TOKEN);
            expect(logged).not.toContain(ID_TOKEN.slice(0, 20));
        });

        it('provedor fora do ar também não vaza o token', async () => {
            const { deps, logger, middleware } = build({
                tokenVerifier: {
                    verify: jest.fn().mockRejectedValue(new AuthUnavailableError('timeout')),
                } as unknown as TokenVerifier,
            });

            await run(middleware, deps.requestContext, `Bearer ${ID_TOKEN}`);

            expect(logger.error).toHaveBeenCalledWith('identity provider unavailable', {
                correlationId: 'correlation-1',
                reason: 'timeout',
            });
            expect(JSON.stringify((logger.error as jest.Mock).mock.calls)).not.toContain(ID_TOKEN);
        });
    });
});
