import type { RequestHandler } from 'express';
import { CustomError } from '@bhs-dev/typescript-common-errors';

import type { RequestContext, RequestStore } from '../platform';
import { isUserProfile, type UserProfile } from './user-profile';

/** Rota montada sem `requireAuthentication` antes: erro de fiação, não do cliente. */
const withoutAuthentication = (guard: string): CustomError =>
    CustomError.internal(
        `${guard} used without requireAuthentication`,
        'PROFILE_GUARD_WITHOUT_AUTHENTICATION',
    );

const forbidden = (message: string): CustomError =>
    new CustomError(403, 'FORBIDDEN', message, { exposeMessage: true });

/** O perfil do membro, ou nulo para quem não é membro de espaço algum. */
const memberProfile = (store: RequestStore): UserProfile | null =>
    store.workspaceId && isUserProfile(store.userProfile) ? store.userProfile : null;

/**
 * RBAC por perfil dentro do espaço (INV-0010-02, spec 0021): o que decide é
 * sempre o membro em `workspace_members`, lido na requisição pela autenticação —
 * nunca um claim do token. É isso que faz conceder e revogar acesso valer na
 * hora, em vez de esperar o token expirar.
 */
export function createRequireProfile(requestContext: RequestContext) {
    return (...allowed: UserProfile[]): RequestHandler =>
        (_req, _res, next) => {
            const store = requestContext.get();

            if (!store?.userId) {
                // Responder 401 esconderia o defeito.
                return next(withoutAuthentication('requireProfile'));
            }

            const profile = memberProfile(store);

            // Sem espaço é o mesmo que sem perfil (ERR-0021-03).
            if (!profile) {
                // Conta existe, mas ninguém aprovou ainda. Erro próprio, e não
                // uma negativa genérica: é o que o frontend usa para explicar a
                // espera em vez de mostrar "acesso negado" (ERR-0010-04).
                return next(
                    new CustomError(
                        403,
                        'PROFILE_PENDING',
                        'Your account has no profile yet; an administrator must grant one',
                        { exposeMessage: true },
                    ),
                );
            }

            if (!allowed.includes(profile)) {
                return next(forbidden('Your profile does not allow this operation'));
            }

            return next();
        };
}

/** Exige a marca de admin da plataforma (spec 0021, ERR-0021-04). */
export function createRequirePlatformAdmin(requestContext: RequestContext) {
    return (): RequestHandler => (_req, _res, next) => {
        const store = requestContext.get();

        if (!store?.userId) return next(withoutAuthentication('requirePlatformAdmin'));

        if (store.isPlatformAdmin !== true) {
            return next(forbidden('Only a platform administrator can perform this operation'));
        }

        return next();
    };
}

/**
 * Leitura de catálogo (spec 0021): passa o membro de um espaço, com qualquer
 * perfil, e o admin da plataforma, mesmo sem espaço. O resto é pendente.
 */
export function createRequireMemberOrPlatformAdmin(requestContext: RequestContext) {
    return (): RequestHandler => (_req, _res, next) => {
        const store = requestContext.get();

        if (!store?.userId) {
            return next(withoutAuthentication('requireMemberOrPlatformAdmin'));
        }

        if (store.isPlatformAdmin === true || memberProfile(store) !== null) return next();

        return next(
            new CustomError(
                403,
                'PROFILE_PENDING',
                'Your account has no profile yet; an administrator must grant one',
                { exposeMessage: true },
            ),
        );
    };
}
