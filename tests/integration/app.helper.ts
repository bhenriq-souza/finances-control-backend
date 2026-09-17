import 'reflect-metadata';
import type { Express } from 'express';
import type { DataSource } from 'typeorm';

import { App } from '../../src/app';
import { container } from '../../src/container';
import { DatabaseConnectionSymbol } from '../../src/platform';
import {
    AuthUnavailableError,
    ExpiredTokenError,
    InvalidTokenError,
    TokenVerifierSymbol,
    User,
    type TokenVerifier,
    type UserProfile,
    type VerifiedToken,
} from '../../src/identity';
import { createIsolatedDataSource, dropIsolatedDataSource } from './database.helper';

/** Tokens com significado próprio, para exercitar cada falha pelo HTTP. */
export const EXPIRED_TOKEN = 'token-expirado';
export const INVALID_TOKEN = 'token-invalido';
export const PROVIDER_DOWN_TOKEN = 'token-provedor-fora';

/**
 * Verificador falso: o token é o próprio UID, e o email sai dele. Isso mantém os
 * testes legíveis (`Bearer uid-admin`) e garante que nenhum deles fale com o
 * Firebase — que é o motivo de a porta `TokenVerifier` existir.
 *
 * Serve a qualquer módulo: toda rota de domínio passa pela mesma autenticação.
 */
const fakeVerifier: TokenVerifier = {
    verify: (idToken: string): Promise<VerifiedToken> => {
        if (idToken === EXPIRED_TOKEN) return Promise.reject(new ExpiredTokenError('expirou'));
        if (idToken === INVALID_TOKEN) return Promise.reject(new InvalidTokenError('assinatura'));
        if (idToken === PROVIDER_DOWN_TOKEN) {
            return Promise.reject(new AuthUnavailableError('timeout'));
        }

        return Promise.resolve({
            uid: idToken,
            email: `${idToken}@exemplo.com`,
            name: `Pessoa ${idToken}`,
        });
    },
};

export type TestApp = {
    app: Express;
    dataSource: DataSource;
    /** Promove alguém direto no banco, para montar o cenário sem passar pela API. */
    setProfile: (uid: string, profile: UserProfile | null, grantedById?: string) => Promise<User>;
    findByUid: (uid: string) => Promise<User | null>;
};

export async function startApp(schema: string): Promise<TestApp> {
    const dataSource = await createIsolatedDataSource(schema);
    await dataSource.runMigrations();

    // Precisa vir antes do `build()`: é nele que as rotas e os serviços são
    // resolvidos do container.
    container.registerInstance(DatabaseConnectionSymbol, dataSource);
    container.registerInstance(TokenVerifierSymbol, fakeVerifier);

    const app = new App().build();
    const users = dataSource.getRepository(User);

    return {
        app,
        dataSource,
        findByUid: (uid) => users.findOne({ where: { firebaseUid: uid } }),
        setProfile: async (uid, profile, grantedById) => {
            const user = await users.findOneByOrFail({ firebaseUid: uid });

            await users.update(
                { id: user.id },
                {
                    profile,
                    profileGrantedAt: profile ? new Date() : null,
                    profileGrantedById: profile ? (grantedById ?? null) : null,
                },
            );

            return users.findOneByOrFail({ id: user.id });
        },
    };
}

export const stopApp = (context: TestApp | undefined, schema: string) =>
    dropIsolatedDataSource(context?.dataSource, schema);
