import type { RequestHandler } from 'express';
import { CustomError } from '@bhs-dev/typescript-common-errors';

import type { RequestContext } from '../platform';
import { isUserProfile, type UserProfile } from './user-profile';

/**
 * RBAC por perfil (INV-0010-02): o que decide é sempre a linha em `users`, lida
 * na requisição pela autenticação — nunca um claim do token. É isso que faz
 * conceder e revogar acesso valer na hora, em vez de esperar o token expirar.
 */
export function createRequireProfile(requestContext: RequestContext) {
    return (...allowed: UserProfile[]): RequestHandler =>
        (_req, _res, next) => {
            const store = requestContext.get();

            if (!store?.userId) {
                // Rota montada sem `requireAuthentication` antes. É erro de
                // fiação, não do cliente: responder 401 esconderia o defeito.
                return next(
                    CustomError.internal(
                        'requireProfile used without requireAuthentication',
                        'PROFILE_GUARD_WITHOUT_AUTHENTICATION',
                    ),
                );
            }

            const profile = store.userProfile;

            if (!profile || !isUserProfile(profile)) {
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
                return next(
                    new CustomError(
                        403,
                        'FORBIDDEN',
                        'Your profile does not allow this operation',
                        { exposeMessage: true },
                    ),
                );
            }

            return next();
        };
}
