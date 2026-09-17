/**
 * Perfis de acesso. A definição vive em `platform/authorization` porque
 * autorização é infraestrutura transversal: todo módulo de domínio precisa do
 * vocabulário para proteger suas rotas, e nenhum pode depender de outro
 * (ADR-0003, regra 2).
 *
 * O `identity` continua sendo quem **implementa** a autorização — quem concede
 * perfil, quem o lê do banco e quem decide a requisição. Este arquivo mantém a
 * interface pública do módulo estável para quem já importava daqui.
 */
export { USER_PROFILES, isUserProfile, type UserProfile } from '../platform';
