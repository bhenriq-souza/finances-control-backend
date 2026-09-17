import type { RequestHandler } from 'express';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import type { ILogger } from '@bhs-dev/typescript-common-types';

import type { RequestContext } from '../platform';
import {
    AuthUnavailableError,
    ExpiredTokenError,
    InvalidTokenError,
    type TokenVerifier,
} from './token-verifier';
import type { UserProvisioningService } from './user-provisioning.service';

const BEARER = /^Bearer (.+)$/;

/**
 * Autenticação de toda rota de domínio (INV-0010-01): verifica o ID token,
 * garante o registro local do usuário e deixa quem ele é no contexto da
 * requisição, de onde o RBAC e os controllers o leem.
 *
 * O token **não é registrado em log**, nem inteiro nem em pedaço (INV-0010-09):
 * ele é credencial válida por uma hora, e um log é lido por muita gente.
 */
export function createAuthenticationMiddleware(deps: {
    tokenVerifier: TokenVerifier;
    provisioning: UserProvisioningService;
    requestContext: RequestContext;
    logger: ILogger;
}): RequestHandler {
    return (req, _res, next) => {
        void authenticate(deps, req.header('authorization')).then(
            ({ id, profile }) => {
                deps.requestContext.setUser(id, profile);
                next();
            },
            (error: unknown) => next(error),
        );
    };
}

async function authenticate(
    deps: {
        tokenVerifier: TokenVerifier;
        provisioning: UserProvisioningService;
        requestContext: RequestContext;
        logger: ILogger;
    },
    header: string | undefined,
): Promise<{ id: string; profile: string | null }> {
    const idToken = BEARER.exec(header ?? '')?.[1]?.trim();

    if (!idToken) {
        // Falha no formato do header, não no conteúdo: dizer isso é seguro e
        // poupa o cliente de procurar problema onde não há (ERR-0010-01).
        throw new CustomError(
            401,
            'UNAUTHENTICATED',
            'Authorization header must be "Bearer <id token>"',
            { exposeMessage: true },
        );
    }

    const verified = await deps.tokenVerifier.verify(idToken).catch((error: unknown) => {
        throw toHttpError(error, deps);
    });

    const user = await deps.provisioning.provision(verified);

    return { id: user.id, profile: user.profile };
}

function toHttpError(
    error: unknown,
    deps: { requestContext: RequestContext; logger: ILogger },
): unknown {
    const correlationId = deps.requestContext.getCorrelationId();

    if (error instanceof ExpiredTokenError) {
        // Distinto de credencial inválida: o cliente resolve renovando (ERR-0010-03).
        return new CustomError(401, 'TOKEN_EXPIRED', 'Id token has expired; renew it and retry', {
            exposeMessage: true,
        });
    }

    if (error instanceof InvalidTokenError) {
        // O motivo do Firebase vai para o log, nunca para a resposta (ERR-0010-02).
        deps.logger.warn('rejected id token', { correlationId, reason: error.reason });

        return new CustomError(401, 'UNAUTHENTICATED', 'Credentials are not valid', {
            exposeMessage: true,
        });
    }

    if (error instanceof AuthUnavailableError) {
        // Falha do provedor não é credencial ruim: responder 401 mandaria o
        // usuário trocar a senha por um problema que não é dele (ERR-0010-10).
        deps.logger.error('identity provider unavailable', { correlationId, reason: error.reason });

        return new CustomError(
            503,
            'AUTH_UNAVAILABLE',
            'Identity provider is unavailable; retry shortly',
            { exposeMessage: true },
        );
    }

    return error;
}
