import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import { Not, type DataSource, type Repository } from 'typeorm';

import { DatabaseConnectionSymbol } from '../platform';
import type { UserProfile } from './user-profile';
import { User } from './user.entity';

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

    async findById(id: string): Promise<User> {
        const user = await this.users.findOne({ where: { id } });

        if (!user) throw userNotFound();

        return user;
    }

    list(): Promise<User[]> {
        return this.users.find({ order: { createdAt: 'ASC' } });
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
