import type { App } from 'firebase-admin/app';
import { inject, injectable } from 'tsyringe';
import type { IEnvService } from '@bhs-dev/typescript-common-types';

import { EnvServiceSymbol } from '../platform';
import { normalizeEmail } from './email';
import {
    AuthUnavailableError,
    ExpiredTokenError,
    InvalidTokenError,
    type TokenVerifier,
    type VerifiedToken,
} from './token-verifier';

/** O mínimo do `DecodedIdToken` que a plataforma consome. */
type DecodedIdToken = {
    uid: string;
    email?: string;
    name?: string;
};

/** Assinatura de `getAuth().verifyIdToken`, injetável para testar sem rede. */
export type VerifyIdToken = (idToken: string) => Promise<DecodedIdToken>;

const FIREBASE_APP_NAME = 'finances-identity';

/**
 * Falha do provedor, não do token: um `auth/internal-error` é o Firebase fora do
 * ar, e responder "credencial inválida" a isso manda o usuário trocar a senha
 * por causa de um problema que não é dele (ERR-0010-10).
 */
const INFRASTRUCTURE_CODES = new Set(['auth/internal-error', 'auth/network-error']);

const errorCodeOf = (error: unknown): string =>
    typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : '';

const reasonOf = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

/**
 * Único ponto do repositório que conhece `firebase-admin` — garantido pelo gate
 * `boundaries` (AC-0010-12). A app do Firebase é criada na primeira verificação,
 * e não no boot: sem isso, um segredo ausente derrubaria o processo em vez de
 * falhar a requisição.
 */
@injectable()
export class FirebaseTokenVerifier implements TokenVerifier {
    private verifier?: Promise<VerifyIdToken>;

    constructor(@inject(EnvServiceSymbol) private readonly env: IEnvService) {}

    /** Ponto de injeção para teste: substitui a verificação real. */
    useVerifier(verifyIdToken: VerifyIdToken): this {
        this.verifier = Promise.resolve(verifyIdToken);

        return this;
    }

    async verify(idToken: string): Promise<VerifiedToken> {
        const decoded = await this.decode(idToken);

        if (!decoded.email) {
            throw new InvalidTokenError('token has no email claim');
        }

        return {
            uid: decoded.uid,
            email: normalizeEmail(decoded.email),
            name: decoded.name?.trim() || null,
        };
    }

    private async decode(idToken: string): Promise<DecodedIdToken> {
        const verify = await (this.verifier ??= this.buildVerifier());

        try {
            return await verify(idToken);
        } catch (error) {
            const code = errorCodeOf(error);
            const reason = reasonOf(error);

            if (code === 'auth/id-token-expired') throw new ExpiredTokenError(reason);
            if (code.startsWith('auth/') && !INFRASTRUCTURE_CODES.has(code)) {
                throw new InvalidTokenError(reason);
            }

            throw new AuthUnavailableError(reason);
        }
    }

    /**
     * `firebase-admin` é carregado aqui, e não no topo do arquivo: ele arrasta
     * dependências publicadas só como ESM, que o Jest (CommonJS) não consegue
     * parsear. Como nenhum teste chega a este caminho — todos injetam um
     * verificador —, carregar sob demanda mantém a suíte de pé e ainda deixa o
     * boot mais barato.
     */
    private async buildVerifier(): Promise<VerifyIdToken> {
        const { getAuth } = await import('firebase-admin/auth');
        const app = await this.firebaseApp();

        return (idToken) => getAuth(app).verifyIdToken(idToken);
    }

    private async firebaseApp(): Promise<App> {
        const { cert, getApps, initializeApp } = await import('firebase-admin/app');
        const existing = getApps().find((app) => app.name === FIREBASE_APP_NAME);

        if (existing) return existing;

        const serviceAccount: unknown = JSON.parse(this.env.getEnv('FIREBASE_SERVICE_ACCOUNT'));

        return initializeApp(
            {
                credential: cert(serviceAccount as Parameters<typeof cert>[0]),
                projectId: this.env.getEnv('FIREBASE_PROJECT_ID'),
            },
            FIREBASE_APP_NAME,
        );
    }
}
