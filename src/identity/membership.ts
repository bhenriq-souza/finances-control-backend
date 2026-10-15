import { In, type EntityManager } from 'typeorm';

import type { User } from './user.entity';
import { WorkspaceMember } from './workspace-member.entity';

/**
 * Preenche `membership` de cada usuário a partir de `workspace_members` (spec 0021):
 * nulo para quem não é membro de espaço algum. Uma consulta só, qualquer que seja
 * o número de usuários.
 */
export async function withMembership<T extends User | User[]>(
    manager: EntityManager,
    users: T,
): Promise<T> {
    const list: User[] = Array.isArray(users) ? users : [users];

    if (list.length === 0) return users;

    const members = await manager.getRepository(WorkspaceMember).find({
        where: { userId: In(list.map((user) => user.id)) },
    });
    const byUser = new Map(members.map((member) => [member.userId, member]));

    for (const user of list) {
        const member = byUser.get(user.id);

        user.membership = member
            ? {
                  workspaceId: member.workspaceId,
                  profile: member.profile,
                  grantedAt: member.grantedAt,
                  grantedById: member.grantedById,
              }
            : null;
    }

    return users;
}
