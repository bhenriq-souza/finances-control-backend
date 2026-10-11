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
    createdAt: string;
};

export const toUserResponse = (user: User): UserResponse => ({
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
    profile: user.profile,
    profileGrantedAt: user.profileGrantedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
});
