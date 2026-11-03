/**
 * Interface pública do módulo `identity`. Outros módulos importam daqui — nunca
 * de caminho interno (ADR-0003, regra 1; gate `boundaries`).
 */
export { USER_PROFILES, isUserProfile, type UserProfile } from './user-profile';
export { normalizeEmail } from './email';
export { User, type UserMembership } from './user.entity';
export { withMembership } from './membership';
export { Workspace } from './workspace.entity';
export { WorkspaceMember } from './workspace-member.entity';
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
export {
    createRequireProfile,
    createRequirePlatformAdmin,
    createRequireMemberOrPlatformAdmin,
} from './profile.guard';
export { UserService } from './user.service';
export { UserController } from './user.controller';
export { UserRoutes } from './user.routes';
export { toUserResponse, type UserResponse } from './user.response';
export * from './identity.symbols';
export { WorkspaceService, type WorkspaceView } from './workspace.service';
export { WorkspaceController, type WorkspaceResponse } from './workspace.controller';
export { WorkspaceRoutes } from './workspace.routes';
