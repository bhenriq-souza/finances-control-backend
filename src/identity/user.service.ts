import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import { ZodError } from 'zod';
import { In, Not, type DataSource, type EntityManager, type Repository } from 'typeorm';

import { DatabaseConnectionSymbol } from '../platform';
import { assertValidAvatar, type AvatarContentType } from './avatar-signature';
import type { UserProfile } from './user-profile';
import type { GrantProfileBody } from './user.schemas';
import { Workspace } from './workspace.entity';
import { workspaceNotFound } from './workspace.service';
import { UserAvatar } from './user-avatar.entity';
import { User } from './user.entity';
import { withMembership } from './membership';
import { WorkspaceMember } from './workspace-member.entity';

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

        return withMembership(this.dataSource.manager, user);
    }

    /** Nome de cada espaço pedido, para o `workspace` do `UserResponse`. */
    async workspaceNames(ids: string[]): Promise<Map<string, string>> {
        if (ids.length === 0) return new Map();

        const rows = await this.dataSource
            .getRepository(Workspace)
            .find({ select: { id: true, name: true }, where: { id: In(ids) } });

        return new Map(rows.map((row) => [row.id, row.name]));
    }

    async list(): Promise<User[]> {
        const users = await this.users.find({ order: { createdAt: 'ASC' } });

        return withMembership(this.dataSource.manager, users);
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

    /**
     * Aprova ou troca o perfil (spec 0021). O corpo tem três formas, e qual vale
     * depende do estado do alvo:
     * - pendente com `workspaceId`: vira membro do espaço;
     * - pendente com `newWorkspace`: cria o espaço e vira o `ADMIN` dele, na mesma
     *   transação;
     * - membro com só `profile`: troca o perfil no espaço em que está.
     * Mudar de espaço não é operação: remove-se e aprova-se de novo.
     */
    grantProfile(params: {
        targetId: string;
        body: GrantProfileBody;
        actorId: string;
    }): Promise<User> {
        const { body, actorId } = params;

        return this.changeMembership(params.targetId, actorId, async (manager, target) => {
            const members = manager.getRepository(WorkspaceMember);
            const grant = { profile: body.profile, grantedAt: new Date(), grantedById: actorId };

            if (target.membership) {
                if (body.workspaceId !== undefined || body.newWorkspace !== undefined) {
                    throw new CustomError(
                        409,
                        'USER_ALREADY_IN_WORKSPACE',
                        'The user already belongs to a workspace; remove them before approving again',
                        { exposeMessage: true },
                    );
                }

                await lockWorkspace(manager, target.membership.workspaceId);
                await assertAdminRemains(manager, target, body.profile);
                await members.update({ userId: target.id }, grant);

                return;
            }

            if (body.workspaceId === undefined && body.newWorkspace === undefined) {
                throw new ZodError([
                    {
                        code: 'custom',
                        path: ['workspaceId'],
                        message:
                            'workspaceId or newWorkspace is required to approve a pending user',
                        input: body,
                    },
                ]);
            }

            let workspaceId: string;

            if (body.newWorkspace) {
                const workspaces = manager.getRepository(Workspace);
                workspaceId = (await workspaces.save(workspaces.create(body.newWorkspace))).id;
            } else {
                const workspace = await manager
                    .getRepository(Workspace)
                    .findOne({ where: { id: body.workspaceId } });

                if (!workspace) throw workspaceNotFound();

                workspaceId = workspace.id;
            }

            await members.insert({ ...grant, workspaceId, userId: target.id });
        });
    }

    /** Tira o usuário do espaço: ele volta a pendente, e os registros do espaço ficam. */
    revokeProfile(params: { targetId: string; actorId: string }): Promise<User> {
        return this.changeMembership(params.targetId, params.actorId, async (manager, target) => {
            if (target.membership) {
                await lockWorkspace(manager, target.membership.workspaceId);
                await assertAdminRemains(manager, target, null);
            }

            await manager.getRepository(WorkspaceMember).delete({ userId: target.id });
        });
    }

    private changeMembership(
        targetId: string,
        actorId: string,
        change: (manager: EntityManager, target: User) => Promise<void>,
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
            const found = await users.findOne({ where: { id: targetId } });

            if (!found) throw userNotFound();

            await change(manager, await withMembership(manager, found));

            return withMembership(manager, await users.findOneByOrFail({ id: targetId }));
        });
    }
}

const userNotFound = (): CustomError =>
    CustomError.notFound('User not found', 'USER_NOT_FOUND', { exposeMessage: true });

/** Serializa as mudanças de membros do mesmo espaço, para a trava de `ADMIN` não correr. */
async function lockWorkspace(manager: EntityManager, workspaceId: string): Promise<void> {
    await manager
        .getRepository(Workspace)
        .findOne({ where: { id: workspaceId }, lock: { mode: 'pessimistic_write' } });
}

/**
 * Todo espaço com membro tem pelo menos um `ADMIN` (INV-0021-07). A checagem
 * roda dentro da transação, contando os outros membros do espaço: trocar o perfil
 * do último `ADMIN` deixa o próprio alvo como membro sem administrador; removê-lo
 * só é recusado se sobrar alguém.
 */
async function assertAdminRemains(
    manager: EntityManager,
    target: User,
    nextProfile: UserProfile | null,
): Promise<void> {
    const membership = target.membership;

    if (membership?.profile !== 'ADMIN' || nextProfile === 'ADMIN') return;

    const members = manager.getRepository(WorkspaceMember);
    const base = { workspaceId: membership.workspaceId, userId: Not(target.id) };
    const otherAdmins = await members.count({ where: { ...base, profile: 'ADMIN' } });

    if (otherAdmins > 0) return;

    const othersLeft = nextProfile === null ? await members.count({ where: base }) : 1;

    if (othersLeft > 0) {
        throw new CustomError(
            409,
            'LAST_WORKSPACE_ADMIN',
            'The workspace would be left without an administrator',
            { exposeMessage: true },
        );
    }
}
