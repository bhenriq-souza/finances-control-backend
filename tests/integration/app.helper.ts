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
    WorkspaceMember,
    withMembership,
    type TokenVerifier,
    type UserProfile,
    type VerifiedToken,
} from '../../src/identity';
import {
    createIsolatedDataSource,
    dropIsolatedDataSource,
    ensureDefaultWorkspace,
} from './database.helper';

export {
    DEFAULT_WORKSPACE_NAME,
    DEFAULT_WORKSPACE_SQL,
    ensureDefaultWorkspace,
} from './database.helper';

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
 *
 * Para os cenários de email verificado e re-vínculo, o token aceita a forma
 * `uid~email~verificado` (`verificado` é `true` ou `false`); sem o `~`, o email
 * sai do UID e vem verificado.
 */
const fakeVerifier: TokenVerifier = {
    verify: (idToken: string): Promise<VerifiedToken> => {
        if (idToken === EXPIRED_TOKEN) return Promise.reject(new ExpiredTokenError('expirou'));
        if (idToken === INVALID_TOKEN) return Promise.reject(new InvalidTokenError('assinatura'));
        if (idToken === PROVIDER_DOWN_TOKEN) {
            return Promise.reject(new AuthUnavailableError('timeout'));
        }

        const [uid = idToken, email, verified] = idToken.split('~');

        return Promise.resolve({
            uid,
            email: email ?? `${uid}@exemplo.com`,
            emailVerified: verified !== 'false',
            name: `Pessoa ${uid}`,
        });
    },
};

export type TestApp = {
    app: Express;
    dataSource: DataSource;
    /** Espaço padrão: `setProfile` torna as pessoas membros dele. */
    workspaceId: string;
    /**
     * Promove alguém direto no banco, para montar o cenário sem passar pela API:
     * com perfil, vira membro do espaço padrão (ou de `workspaceId`); sem, deixa
     * de ser membro.
     */
    setProfile: (
        uid: string,
        profile: UserProfile | null,
        grantedById?: string,
        workspaceId?: string,
    ) => Promise<User>;
    findByUid: (uid: string) => Promise<User | null>;
    /**
     * Marca (ou desmarca) alguém como administrador da plataforma direto no banco:
     * é quem escreve nos catálogos globais (bancos e tipos), independente do perfil
     * no espaço.
     */
    setPlatformAdmin: (uid: string, value?: boolean) => Promise<void>;
};

export async function startApp(schema: string): Promise<TestApp> {
    const dataSource = await createIsolatedDataSource(schema);
    await dataSource.runMigrations();
    const defaultWorkspaceId = await ensureDefaultWorkspace(dataSource);

    // Precisa vir antes do `build()`: é nele que as rotas e os serviços são
    // resolvidos do container.
    container.registerInstance(DatabaseConnectionSymbol, dataSource);
    container.registerInstance(TokenVerifierSymbol, fakeVerifier);

    const app = new App().build();
    const users = dataSource.getRepository(User);
    const members = dataSource.getRepository(WorkspaceMember);

    return {
        app,
        dataSource,
        workspaceId: defaultWorkspaceId,
        findByUid: async (uid) => {
            const user = await users.findOne({ where: { firebaseUid: uid } });

            return user && withMembership(dataSource.manager, user);
        },
        setPlatformAdmin: async (uid, value = true) => {
            await dataSource.query(
                'UPDATE users SET is_platform_admin = $2 WHERE firebase_uid = $1',
                [uid, value],
            );
        },
        setProfile: async (uid, profile, grantedById, workspaceId) => {
            const user = await users.findOneByOrFail({ firebaseUid: uid });

            await members.delete({ userId: user.id });

            if (profile) {
                await members.insert({
                    workspaceId: workspaceId ?? defaultWorkspaceId,
                    userId: user.id,
                    profile,
                    grantedAt: new Date(),
                    grantedById: grantedById ?? null,
                });
            }

            return withMembership(dataSource.manager, await users.findOneByOrFail({ id: user.id }));
        },
    };
}

export const stopApp = (context: TestApp | undefined, schema: string) =>
    dropIsolatedDataSource(context?.dataSource, schema);
