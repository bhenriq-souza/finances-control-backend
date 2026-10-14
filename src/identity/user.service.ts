import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import { In, Not, type DataSource, type Repository } from 'typeorm';

import { DatabaseConnectionSymbol } from '../platform';
import { assertValidAvatar, type AvatarContentType } from './avatar-signature';
import type { UserProfile } from './user-profile';
import { UserAvatar } from './user-avatar.entity';
import { User } from './user.entity';

/** A foto como sai para o cliente: os bytes e o tipo gravado. */
export type StoredAvatar = { content: Buffer; contentType: AvatarContentType };

/**
 * Leitura e concessão de perfil (spec 0010). O perfil é o que autoriza tudo o
 * mais na plataforma, então as duas travas de segurança vivem aqui, no mesmo
 * lugar da escrita — e não na rota, de onde sairiam com o primeiro atalho.
 */
@injectable()
export class UserService {
    constructor(@inject(DatabaseConnectionSymbol) private readonly dataSource: DataSource) {}

    private get users(): Repository<User> {
        return this.dataSource.getRepository(User);
    }

    private get avatars(): Repository<UserAvatar> {
        return this.dataSource.getRepository(UserAvatar);
    }

    async findById(id: string): Promise<User> {
        const user = await this.users.findOne({ where: { id } });

        if (!user) throw userNotFound();

        return user;
    }

    list(): Promise<User[]> {
        return this.users.find({ order: { createdAt: 'ASC' } });
    }

    /**
     * `updated_at` da foto de cada usuário que tem uma. Lê só a data, nunca os
     * bytes (INV-0010-14): é o que vai no `UserResponse`.
     */
    async avatarUpdatedAt(userIds: string[]): Promise<Map<string, Date>> {
        if (userIds.length === 0) return new Map();

        const rows = await this.avatars.find({
            select: { userId: true, updatedAt: true },
            where: { userId: In(userIds) },
        });

        return new Map(rows.map((row) => [row.userId, row.updatedAt]));
    }

    /**
     * Grava ou troca a foto do próprio usuário (INV-0010-13). A validação vem
     * antes de qualquer escrita: foto recusada não muda nada (ERR-0010-12/13).
     */
    async saveAvatar(params: {
        userId: string;
        contentType: string | undefined;
        content: Buffer;
    }): Promise<User> {
        const contentType = assertValidAvatar(params.contentType, params.content);

        // Uma linha por usuário: o segundo envio substitui o primeiro, e o
        // trigger de `updated_at` marca a troca.
        await this.avatars
            .createQueryBuilder()
            .insert()
            .into(UserAvatar)
            .values({
                userId: params.userId,
                content: params.content,
                contentType,
                sizeBytes: params.content.length,
            })
            .orUpdate(['content', 'content_type', 'size_bytes'], ['user_id'])
            .execute();

        return this.findById(params.userId);
    }

    /** Sem foto também é sucesso: o estado pedido já vale. */
    async removeAvatar(userId: string): Promise<void> {
        await this.avatars.delete({ userId });
    }

    /** Única leitura que pede os bytes, e só os do próprio usuário. */
    async findAvatar(userId: string): Promise<StoredAvatar> {
        const avatar = await this.avatars.findOne({
            select: { userId: true, content: true, contentType: true },
            where: { userId },
        });

        if (!avatar) {
            throw CustomError.notFound('You have no avatar', 'AVATAR_NOT_FOUND', {
                exposeMessage: true,
            });
        }

        return { content: avatar.content, contentType: avatar.contentType };
    }

    grantProfile(params: {
        targetId: string;
        profile: UserProfile;
        actorId: string;
    }): Promise<User> {
        return this.changeProfile(params.targetId, params.actorId, {
            profile: params.profile,
            profileGrantedAt: new Date(),
            profileGrantedById: params.actorId,
        });
    }

    revokeProfile(params: { targetId: string; actorId: string }): Promise<User> {
        return this.changeProfile(params.targetId, params.actorId, {
            profile: null,
            profileGrantedAt: null,
            profileGrantedById: null,
        });
    }

    private changeProfile(
        targetId: string,
        actorId: string,
        changes: Partial<User>,
    ): Promise<User> {
        // Ninguém muda o próprio perfil (INV-0010-05). A checagem vem antes de
        // qualquer leitura: é regra sobre quem pede, não sobre o estado do banco.
        if (targetId === actorId) {
            throw new CustomError(
                409,
                'CANNOT_CHANGE_OWN_PROFILE',
                'Your own profile can only be changed by another administrator',
                { exposeMessage: true },
            );
        }

        return this.dataSource.transaction(async (manager) => {
            const users = manager.getRepository(User);
            const target = await users.findOne({ where: { id: targetId } });

            if (!target) throw userNotFound();

            await assertAdminRemains(users, target, changes.profile ?? null);
            await users.update({ id: targetId }, changes);

            return users.findOneByOrFail({ id: targetId });
        });
    }
}

const userNotFound = (): CustomError =>
    CustomError.notFound('User not found', 'USER_NOT_FOUND', { exposeMessage: true });

/**
 * A plataforma nunca fica sem `ADMIN` (INV-0010-06): sem nenhum, não há quem
 * conceda perfil a ninguém, e a saída seria mexer no banco à mão.
 *
 * A checagem roda dentro da transação, contando os outros administradores — não
 * o alvo, que é quem está prestes a deixar de ser um.
 */
async function assertAdminRemains(
    users: Repository<User>,
    target: User,
    nextProfile: UserProfile | null,
): Promise<void> {
    const losingAdmin = target.profile === 'ADMIN' && nextProfile !== 'ADMIN';

    if (!losingAdmin) return;

    const otherAdmins = await users.count({ where: { profile: 'ADMIN', id: Not(target.id) } });

    if (otherAdmins === 0) {
        throw new CustomError(
            409,
            'LAST_ADMIN',
            'The platform would be left without an administrator',
            { exposeMessage: true },
        );
    }
}
