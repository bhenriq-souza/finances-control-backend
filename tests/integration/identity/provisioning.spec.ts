import 'reflect-metadata';
import type { DataSource, Repository } from 'typeorm';
import type { IEnvService } from '@bhs-dev/typescript-common-types';

import { User } from '../../../src/identity/user.entity';
import { UserProvisioningService } from '../../../src/identity/user-provisioning.service';
import type { VerifiedToken } from '../../../src/identity/token-verifier';
import { createIsolatedDataSource, dropIsolatedDataSource } from '../database.helper';

const SCHEMA = 'test_identity_provisioning';
const BOOTSTRAP_EMAIL = 'dono@exemplo.com';

const envWith = (bootstrap?: string): IEnvService => ({
    getEnv: (key: string) => (key === 'IDENTITY_BOOTSTRAP_ADMIN_EMAIL' ? bootstrap : '') as string,
});

const token = (overrides: Partial<VerifiedToken> = {}): VerifiedToken => ({
    uid: 'firebase-uid-1',
    email: 'pessoa@exemplo.com',
    name: 'Pessoa Comum',
    ...overrides,
});

describe('provisionamento no primeiro acesso (spec 0010)', () => {
    let dataSource: DataSource;
    let users: Repository<User>;

    const serviceWith = (bootstrap?: string) =>
        new UserProvisioningService(dataSource, envWith(bootstrap));

    beforeAll(async () => {
        dataSource = await createIsolatedDataSource(SCHEMA);
        await dataSource.runMigrations();
        users = dataSource.getRepository(User);
    });

    afterAll(async () => {
        await dropIsolatedDataSource(dataSource, SCHEMA);
    });

    afterEach(async () => {
        await dataSource.query('DELETE FROM users');
    });

    describe('usuário comum', () => {
        it('cria o registro sem perfil no primeiro acesso (AC-0010-02)', async () => {
            const user = await serviceWith().provision(token());

            expect(user).toMatchObject({
                firebaseUid: 'firebase-uid-1',
                email: 'pessoa@exemplo.com',
                name: 'Pessoa Comum',
                profile: null,
                profileGrantedAt: null,
                profileGrantedById: null,
            });
            expect(user.createdAt).toBeInstanceOf(Date);
        });

        it('não cria um segundo registro para o mesmo UID (AC-0010-02)', async () => {
            const first = await serviceWith().provision(token());
            const second = await serviceWith().provision(token());

            expect(second.id).toBe(first.id);
            await expect(users.count()).resolves.toBe(1);
        });

        it('normaliza o email antes de gravar (INV-0010-08)', async () => {
            const user = await serviceWith().provision(token({ email: '  Pessoa@Exemplo.COM ' }));

            expect(user.email).toBe('pessoa@exemplo.com');
        });

        it('usa o email como nome quando o Firebase não tem display name', async () => {
            const user = await serviceWith().provision(token({ name: null }));

            expect(user.name).toBe('pessoa@exemplo.com');
        });

        it('atualiza email e nome quando mudam no Firebase', async () => {
            await serviceWith().provision(token());

            const updated = await serviceWith().provision(
                token({ email: 'novo@exemplo.com', name: 'Nome Novo' }),
            );

            expect(updated).toMatchObject({ email: 'novo@exemplo.com', name: 'Nome Novo' });
            await expect(users.count()).resolves.toBe(1);
        });

        it('não rebaixa o nome para o email quando o Firebase deixa de ter um', async () => {
            await serviceWith().provision(token());

            const updated = await serviceWith().provision(token({ name: null }));

            expect(updated.name).toBe('Pessoa Comum');
        });

        it('nunca toca no perfil ao atualizar', async () => {
            const created = await serviceWith().provision(token());
            await users.update({ id: created.id }, { profile: 'VIEWER' });

            const refreshed = await serviceWith().provision(token({ name: 'Outro Nome' }));

            expect(refreshed.profile).toBe('VIEWER');
        });
    });

    describe('bootstrap do primeiro Admin', () => {
        const bootstrapToken = token({ uid: 'uid-do-dono', email: BOOTSTRAP_EMAIL });

        it('cria já como ADMIN, por concessão do sistema (AC-0010-03)', async () => {
            const user = await serviceWith(BOOTSTRAP_EMAIL).provision(bootstrapToken);

            expect(user.profile).toBe('ADMIN');
            expect(user.profileGrantedById).toBeNull();
            expect(user.profileGrantedAt).toBeInstanceOf(Date);
        });

        it('repetir o acesso não muda nada (AC-0010-03)', async () => {
            const first = await serviceWith(BOOTSTRAP_EMAIL).provision(bootstrapToken);
            const second = await serviceWith(BOOTSTRAP_EMAIL).provision(bootstrapToken);

            expect(second.profile).toBe('ADMIN');
            expect(second.profileGrantedAt?.getTime()).toBe(first.profileGrantedAt?.getTime());
        });

        it('compara o email na forma normalizada dos dois lados', async () => {
            const user = await serviceWith('  Dono@Exemplo.COM ').provision(bootstrapToken);

            expect(user.profile).toBe('ADMIN');
        });

        it('promove quem já existia sem perfil', async () => {
            await serviceWith().provision(bootstrapToken);

            const promoted = await serviceWith(BOOTSTRAP_EMAIL).provision(bootstrapToken);

            expect(promoted.profile).toBe('ADMIN');
        });

        it('não preserva concessão humana quando ainda não é ADMIN, mas promove', async () => {
            const admin = await serviceWith().provision(token({ uid: 'admin', email: 'a@b.com' }));
            const created = await serviceWith().provision(bootstrapToken);
            await users.update(
                { id: created.id },
                { profile: 'BILLER', profileGrantedAt: new Date(), profileGrantedById: admin.id },
            );

            const promoted = await serviceWith(BOOTSTRAP_EMAIL).provision(bootstrapToken);

            expect(promoted.profile).toBe('ADMIN');
            expect(promoted.profileGrantedById).toBeNull();
        });

        it('não rebaixa nem reescreve quem já é ADMIN por concessão humana (AC-0010-04)', async () => {
            const admin = await serviceWith().provision(token({ uid: 'admin', email: 'a@b.com' }));
            const created = await serviceWith().provision(bootstrapToken);
            await users.update(
                { id: created.id },
                { profile: 'ADMIN', profileGrantedAt: new Date(), profileGrantedById: admin.id },
            );

            const after = await serviceWith(BOOTSTRAP_EMAIL).provision(bootstrapToken);

            expect(after.profile).toBe('ADMIN');
            expect(after.profileGrantedById).toBe(admin.id);
        });

        it('sem a variável configurada, ninguém é promovido (INV-0010-04)', async () => {
            const user = await serviceWith().provision(bootstrapToken);

            expect(user.profile).toBeNull();
        });

        it.each(['', '   '])('variável vazia (%p) também desliga o bootstrap', async (value) => {
            const user = await serviceWith(value).provision(bootstrapToken);

            expect(user.profile).toBeNull();
        });

        it('não promove quem tem outro email', async () => {
            const user = await serviceWith(BOOTSTRAP_EMAIL).provision(token());

            expect(user.profile).toBeNull();
        });
    });

    describe('acessos simultâneos', () => {
        it('duas primeiras requisições juntas criam um usuário só', async () => {
            const service = serviceWith();

            const [first, second] = await Promise.all([
                service.provision(token()),
                service.provision(token()),
            ]);

            expect(second!.id).toBe(first!.id);
            await expect(users.count()).resolves.toBe(1);
        });
    });
});
