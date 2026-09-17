/** O que a plataforma precisa saber de um ID token verificado (spec 0010). */
export type VerifiedToken = {
    uid: string;
    email: string;
    name: string | null;
};

/**
 * Porta de verificação de identidade. O resto do módulo depende desta interface,
 * não do Firebase — é o que permite testar autenticação e autorização sem rede e
 * sem projeto Firebase (INV-0010-07).
 */
export interface TokenVerifier {
    verify(idToken: string): Promise<VerifiedToken>;
}

/**
 * Falhas da verificação, distintas porque o cliente reage a cada uma de um jeito:
 * renovar o token, refazer o login, ou tentar de novo mais tarde. A tradução para
 * HTTP é do middleware (spec 0010, Error cases); aqui só se classifica.
 *
 * `reason` carrega o motivo original para o log — ele nunca vai para a resposta.
 */
export class InvalidTokenError extends Error {
    constructor(readonly reason: string) {
        super('id token is not valid');
        this.name = 'InvalidTokenError';
    }
}

export class ExpiredTokenError extends Error {
    constructor(readonly reason: string) {
        super('id token has expired');
        this.name = 'ExpiredTokenError';
    }
}

export class AuthUnavailableError extends Error {
    constructor(readonly reason: string) {
        super('identity provider is unavailable');
        this.name = 'AuthUnavailableError';
    }
}
