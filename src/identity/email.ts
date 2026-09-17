/**
 * Forma canônica do email (INV-0010-08). Gravação e comparação usam sempre esta
 * forma — inclusive a comparação com o email de bootstrap do Admin —, de modo que
 * `Bruno@Exemplo.com ` e `bruno@exemplo.com` sejam o mesmo usuário e a segunda
 * gravação esbarre em `uq_users_email`.
 */
export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}
