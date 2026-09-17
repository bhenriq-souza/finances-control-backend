/**
 * Perfis de acesso da plataforma. Perfil é **um só por usuário** — quem precisa
 * de outro pede a um Admin, não acumula (spec 0010).
 *
 * Persistido como `text` sob CHECK, e não como tipo `enum` do PostgreSQL:
 * acrescentar um valor é uma linha de migration, em vez do ritual de `ALTER TYPE`.
 */
export const USER_PROFILES = ['ADMIN', 'BILLER', 'VIEWER'] as const;

export type UserProfile = (typeof USER_PROFILES)[number];

export const isUserProfile = (value: unknown): value is UserProfile =>
    typeof value === 'string' && USER_PROFILES.includes(value as UserProfile);
