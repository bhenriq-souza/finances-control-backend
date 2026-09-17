/**
 * Interface pública do módulo `identity`. Outros módulos importam daqui — nunca
 * de caminho interno (ADR-0003, regra 1; gate `boundaries`).
 */
export { USER_PROFILES, isUserProfile, type UserProfile } from './user-profile';
export { normalizeEmail } from './email';
export { User } from './user.entity';
