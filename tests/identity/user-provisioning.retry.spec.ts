import 'reflect-metadata';
import { QueryFailedError, type DataSource } from 'typeorm';
import type { IEnvService } from '@bhs-dev/typescript-common-types';

import { UserProvisioningService } from '../../src/identity/user-provisioning.service';
import type { User } from '../../src/identity/user.entity';

/**
 * A corrida entre duas primeiras requisições do mesmo usuário não é reprodutível
 * de fora: em teste de integração as transações acabam serializando. Aqui o
 * conflito é forçado, que é a única forma de exercitar o retry de propósito.
 */
const env: IEnvService = { getEnv: () => '' };

const uniqueViolation = (constraint: string): QueryFailedError =>
    new QueryFailedError(
        'INSERT INTO users ...',
        [],
        Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
            code: '23505',
            constraint,
        }),
    );

const dataSourceThatFailsOnce = (error: unknown, result: Partial<User>) => {
    const transaction = jest
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(result as User);

    return { dataSource: { transaction } as unknown as DataSource, transaction };
};

const token = { uid: 'uid-1', email: 'pessoa@exemplo.com', name: 'Pessoa' };

describe('UserProvisioningService — corrida no primeiro acesso', () => {
    it('relê e segue quando perde a corrida pelo firebase_uid', async () => {
        const winner = { id: 'id-do-vencedor' };
        const { dataSource, transaction } = dataSourceThatFailsOnce(
            uniqueViolation('uq_users_firebase_uid'),
            winner,
        );

        const user = await new UserProvisioningService(dataSource, env).provision(token);

        expect(user).toBe(winner);
        expect(transaction).toHaveBeenCalledTimes(2);
    });

    it('não engole conflito de outra constraint — email duplicado é problema de verdade', async () => {
        const { dataSource, transaction } = dataSourceThatFailsOnce(
            uniqueViolation('uq_users_email'),
            {},
        );

        await expect(
            new UserProvisioningService(dataSource, env).provision(token),
        ).rejects.toBeInstanceOf(QueryFailedError);
        expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('não confunde erro comum com conflito', async () => {
        const { dataSource, transaction } = dataSourceThatFailsOnce(new Error('conexão caiu'), {});

        await expect(new UserProvisioningService(dataSource, env).provision(token)).rejects.toThrow(
            'conexão caiu',
        );
        expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('tenta uma vez só: um segundo conflito é sintoma, não corrida', async () => {
        const conflict = uniqueViolation('uq_users_firebase_uid');
        const transaction = jest.fn().mockRejectedValue(conflict);
        const dataSource = { transaction } as unknown as DataSource;

        await expect(
            new UserProvisioningService(dataSource, env).provision(token),
        ).rejects.toBeInstanceOf(QueryFailedError);
        expect(transaction).toHaveBeenCalledTimes(2);
    });
});
