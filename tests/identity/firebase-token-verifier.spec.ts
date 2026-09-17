import 'reflect-metadata';
import type { IEnvService } from '@bhs-dev/typescript-common-types';

import { FirebaseTokenVerifier } from '../../src/identity/firebase-token-verifier';
import {
    AuthUnavailableError,
    ExpiredTokenError,
    InvalidTokenError,
} from '../../src/identity/token-verifier';
import { cert, getApps, initializeApp, resetApps } from '../mocks/firebase-admin-app';
import { verifyIdToken } from '../mocks/firebase-admin-auth';

const env: IEnvService = { getEnv: () => '' };

const firebaseError = (code: string, message = 'firebase said no'): Error =>
    Object.assign(new Error(message), { code });

const verifierThatReturns = (decoded: Record<string, unknown>) =>
    new FirebaseTokenVerifier(env).useVerifier(async () => decoded as never);

const verifierThatThrows = (error: unknown) =>
    new FirebaseTokenVerifier(env).useVerifier(async () => {
        throw error;
    });

describe('FirebaseTokenVerifier — inicialização do SDK', () => {
    beforeEach(() => {
        resetApps();
        verifyIdToken.mockReset();
    });

    const envWithCredentials: IEnvService = {
        getEnv: (key: string) =>
            ({
                FIREBASE_PROJECT_ID: 'finances-prod',
                FIREBASE_SERVICE_ACCOUNT: '{"type":"service_account","project_id":"finances-prod"}',
            })[key] ?? '',
    };

    it('cria a app do Firebase com a credencial do ambiente', async () => {
        verifyIdToken.mockResolvedValue({ uid: 'u', email: 'a@b.com' });

        await new FirebaseTokenVerifier(envWithCredentials).verify('token');

        expect(cert).toHaveBeenCalledWith({
            type: 'service_account',
            project_id: 'finances-prod',
        });
        expect(initializeApp).toHaveBeenCalledTimes(1);
        expect(initializeApp.mock.calls[0]?.[1]).toBe('finances-identity');
        expect(verifyIdToken).toHaveBeenCalledWith('token');
    });

    it('reaproveita a app já criada em vez de inicializar outra', async () => {
        verifyIdToken.mockResolvedValue({ uid: 'u', email: 'a@b.com' });

        await new FirebaseTokenVerifier(envWithCredentials).verify('token');
        await new FirebaseTokenVerifier(envWithCredentials).verify('token');

        expect(initializeApp).toHaveBeenCalledTimes(1);
        expect(getApps).toHaveBeenCalled();
    });

    it('só carrega o SDK quando de fato verifica um token', async () => {
        new FirebaseTokenVerifier(envWithCredentials);

        expect(initializeApp).not.toHaveBeenCalled();
    });
});

describe('FirebaseTokenVerifier', () => {
    describe('token válido', () => {
        it('devolve uid, email normalizado e nome', async () => {
            const verifier = verifierThatReturns({
                uid: 'firebase-uid',
                email: '  Bruno@Exemplo.COM ',
                name: '  Bruno Souza  ',
            });

            await expect(verifier.verify('token')).resolves.toEqual({
                uid: 'firebase-uid',
                email: 'bruno@exemplo.com',
                name: 'Bruno Souza',
            });
        });

        it.each([[undefined], [''], ['   ']])('trata nome %p como ausente', async (name) => {
            const verifier = verifierThatReturns({ uid: 'u', email: 'a@b.com', name });

            await expect(verifier.verify('token')).resolves.toMatchObject({ name: null });
        });

        it('recusa token sem email: sem ele não há como identificar o usuário', async () => {
            const verifier = verifierThatReturns({ uid: 'u' });

            await expect(verifier.verify('token')).rejects.toBeInstanceOf(InvalidTokenError);
        });
    });

    describe('classificação de falhas', () => {
        it('token expirado é distinto de token inválido (ERR-0010-03)', async () => {
            const verifier = verifierThatThrows(firebaseError('auth/id-token-expired'));

            await expect(verifier.verify('token')).rejects.toBeInstanceOf(ExpiredTokenError);
        });

        it.each(['auth/argument-error', 'auth/id-token-revoked', 'auth/invalid-id-token'])(
            'trata %s como token inválido (ERR-0010-02)',
            async (code) => {
                const verifier = verifierThatThrows(firebaseError(code));

                await expect(verifier.verify('token')).rejects.toBeInstanceOf(InvalidTokenError);
            },
        );

        it.each(['auth/internal-error', 'auth/network-error'])(
            'trata %s como provedor fora do ar, não como credencial ruim (ERR-0010-10)',
            async (code) => {
                const verifier = verifierThatThrows(firebaseError(code));

                await expect(verifier.verify('token')).rejects.toBeInstanceOf(AuthUnavailableError);
            },
        );

        it('erro sem código é falha de infraestrutura', async () => {
            const verifier = verifierThatThrows(new Error('ECONNRESET'));

            await expect(verifier.verify('token')).rejects.toBeInstanceOf(AuthUnavailableError);
        });

        it('rejeição que não é Error também vira indisponibilidade', async () => {
            const verifier = verifierThatThrows('boom');

            await expect(verifier.verify('token')).rejects.toBeInstanceOf(AuthUnavailableError);
        });
    });

    describe('o que vaza para fora', () => {
        it('guarda o motivo do Firebase em reason, fora da mensagem (ERR-0010-02)', async () => {
            const verifier = verifierThatThrows(
                firebaseError('auth/argument-error', 'Decoding Firebase ID token failed: kid=abc'),
            );

            const error = await verifier.verify('token').catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(InvalidTokenError);
            expect((error as InvalidTokenError).reason).toContain('kid=abc');
            expect((error as Error).message).toBe('id token is not valid');
        });
    });
});
