import type { User } from './user.entity';
import type { UserProfile } from './user-profile';

/** O que a API publica sobre um usuário. O `firebase_uid` não sai daqui. */
export type UserResponse = {
    id: string;
    email: string;
    emailVerified: boolean;
    name: string;
    profile: UserProfile | null;
    profileGrantedAt: string | null;
    /**
     * `updated_at` da foto, ou nulo sem foto: o frontend sabe se há foto e quando
     * ela mudou sem pedir os bytes (spec 0010).
     */
    avatarUpdatedAt: string | null;
    createdAt: string;
};

export const toUserResponse = (user: User, avatarUpdatedAt: Date | null): UserResponse => ({
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
    // O perfil é o do membro do espaço (spec 0021); pendente não tem nenhum.
    profile: user.membership?.profile ?? null,
    profileGrantedAt: user.membership?.grantedAt.toISOString() ?? null,
    avatarUpdatedAt: avatarUpdatedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
});
