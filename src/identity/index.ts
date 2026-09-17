/**
 * Interface pública do módulo `identity`. Outros módulos importam daqui — nunca
 * de caminho interno (ADR-0003, regra 1; gate `boundaries`).
 */
export { USER_PROFILES, isUserProfile, type UserProfile } from './user-profile';
export { normalizeEmail } from './email';
export { User } from './user.entity';
export {
    AuthUnavailableError,
    ExpiredTokenError,
    InvalidTokenError,
    type TokenVerifier,
    type VerifiedToken,
} from './token-verifier';
export { FirebaseTokenVerifier, type VerifyIdToken } from './firebase-token-verifier';
export { UserProvisioningService } from './user-provisioning.service';
export { createAuthenticationMiddleware } from './authentication.middleware';
export { createRequireProfile } from './profile.guard';
export { UserService } from './user.service';
export { UserController } from './user.controller';
export { UserRoutes } from './user.routes';
export { toUserResponse, type UserResponse } from './user.response';
export * from './identity.symbols';
