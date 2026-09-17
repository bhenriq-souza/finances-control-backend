import type { RequestHandler } from 'express';

/**
 * Vocabulário de autorização da plataforma.
 *
 * Os perfis são definidos pelo produto
 * ([user-profiles](https://github.com/bhenriq-souza/finances-control/blob/main/docs/user-profiles.md))
 * e implementados pelo módulo `identity`, mas **vivem aqui** porque autorização é
 * infraestrutura transversal (ADR-0003): todo módulo de domínio precisa dizer
 * quem alcança cada rota, e nenhum deles pode depender de outro para isso.
 *
 * A alternativa seria tipar a lista de perfis permitidos como `string[]`, e
 * perder a verificação em tempo de compilação em toda rota do sistema por causa
 * de uma fronteira que este arquivo já respeita.
 */
export const USER_PROFILES = ['ADMIN', 'BILLER', 'VIEWER'] as const;

export type UserProfile = (typeof USER_PROFILES)[number];

export const isUserProfile = (value: unknown): value is UserProfile =>
    typeof value === 'string' && USER_PROFILES.includes(value as UserProfile);

/** Contrato da guarda de perfil. A implementação é do `identity`. */
export type RequireProfile = (...profiles: UserProfile[]) => RequestHandler;
