import 'reflect-metadata';
import type { DataSource, Repository } from 'typeorm';
import type { IEnvService } from '@bhs-dev/typescript-common-types';

import { User } from '../../../src/identity/user.entity';
import { WorkspaceMember } from '../../../src/identity/workspace-member.entity';
import type { UserProfile } from '../../../src/identity/user-profile';
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
    emailVerified: true,
    name: 'Pessoa Comum',
    ...overrides,
});

const profileOf = (user: User): UserProfile | null => user.membership?.profile ?? null;

describe('provisionamento no primeiro acesso (spec 0010)', () => {
    let dataSource: DataSource;
    let users: Repository<User>;

    /** Torna o usuário membro de um espaço, como a concessão faria (spec 0021). */
    const makeMember = async (
        userId: string,
        profile: UserProfile,
        grantedById: string | null = null,
    ): Promise<void> => {
        const [workspace] = (await dataSource.query(
            "INSERT INTO workspaces (name) VALUES ('Casa') RETURNING id",
        )) as [{ id: string }];

        await dataSource.getRepository(WorkspaceMember).insert({
            workspaceId: workspace.id,
            userId,
            profile,
            grantedAt: new Date(),
            grantedById,
        });
    };

    const workspaceCount = async (): Promise<number> =>
        Number(
            ((await dataSource.query('SELECT count(*) AS n FROM workspaces')) as [{ n: string }])[0]
                .n,
        );

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
        await dataSource.query('DELETE FROM workspace_members');
        await dataSource.query('DELETE FROM users');
        await dataSource.query('DELETE FROM workspaces');
    });

    describe('usuário comum', () => {
        it('cria o registro sem perfil no primeiro acesso (AC-0010-02)', async () => {
            const user = await serviceWith().provision(token());

            expect(user).toMatchObject({
                firebaseUid: 'firebase-uid-1',
                email: 'pessoa@exemplo.com',
                name: 'Pessoa Comum',
                isPlatformAdmin: false,
                membership: null,
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
            await makeMember(created.id, 'VIEWER');

            const refreshed = await serviceWith().provision(token({ name: 'Outro Nome' }));

            expect(profileOf(refreshed)).toBe('VIEWER');
        });
    });

    describe('bootstrap do primeiro Admin', () => {
        const bootstrapToken = token({ uid: 'uid-do-dono', email: BOOTSTRAP_EMAIL });

        it('cria já como admin da plataforma e ADMIN de um espaço com o nome dele, por concessão do sistema (AC-0010-03, spec 0021)', async () => {
            const user = await serviceWith(BOOTSTRAP_EMAIL).provision(bootstrapToken);

            expect(user.isPlatformAdmin).toBe(true);
            expect(profileOf(user)).toBe('ADMIN');
            expect(user.membership?.grantedById).toBeNull();
            expect(user.membership?.grantedAt).toBeInstanceOf(Date);

            const [workspace] = (await dataSource.query(
                'SELECT name FROM workspaces WHERE id = $1',
                [user.membership?.workspaceId],
            )) as [{ name: string }];
            expect(workspace.name).toBe('Pessoa Comum');
        });

        it('sem nome, o espaço leva o email', async () => {
            const user = await serviceWith(BOOTSTRAP_EMAIL).provision({
                ...bootstrapToken,
                name: null,
            });

            const [workspace] = (await dataSource.query(
                'SELECT name FROM workspaces WHERE id = $1',
                [user.membership?.workspaceId],
            )) as [{ name: string }];
            expect(workspace.name).toBe(BOOTSTRAP_EMAIL);
        });

        it('repetir o acesso não muda nada (AC-0010-03)', async () => {
            const first = await serviceWith(BOOTSTRAP_EMAIL).provision(bootstrapToken);
            const second = await serviceWith(BOOTSTRAP_EMAIL).provision(bootstrapToken);

            expect(profileOf(second)).toBe('ADMIN');
            expect(second.membership?.workspaceId).toBe(first.membership?.workspaceId);
            expect(second.membership?.grantedAt.getTime()).toBe(
                first.membership?.grantedAt.getTime(),
            );
            await expect(workspaceCount()).resolves.toBe(1);
        });

        it('compara o email na forma normalizada dos dois lados', async () => {
            const user = await serviceWith('  Dono@Exemplo.COM ').provision(bootstrapToken);

            expect(user.isPlatformAdmin).toBe(true);
            expect(profileOf(user)).toBe('ADMIN');
        });

        it('promove quem já existia sem perfil', async () => {
            await serviceWith().provision(bootstrapToken);

            const promoted = await serviceWith(BOOTSTRAP_EMAIL).provision(bootstrapToken);

            expect(promoted.isPlatformAdmin).toBe(true);
            expect(profileOf(promoted)).toBe('ADMIN');
        });

        it('membro com outro perfil ganha a marca e continua no espaço com o perfil dele (spec 0021)', async () => {
            const admin = await serviceWith().provision(token({ uid: 'admin', email: 'a@b.com' }));
            const created = await serviceWith().provision(bootstrapToken);
            await makeMember(created.id, 'BILLER', admin.id);

            const promoted = await serviceWith(BOOTSTRAP_EMAIL).provision(bootstrapToken);

            expect(promoted.isPlatformAdmin).toBe(true);
            expect(profileOf(promoted)).toBe('BILLER');
            expect(promoted.membership?.grantedById).toBe(admin.id);
            await expect(workspaceCount()).resolves.toBe(1);
        });

        it('não rebaixa nem reescreve quem já é ADMIN por concessão humana (AC-0010-04)', async () => {
            const admin = await serviceWith().provision(token({ uid: 'admin', email: 'a@b.com' }));
            const created = await serviceWith().provision(bootstrapToken);
            await makeMember(created.id, 'ADMIN', admin.id);

            const after = await serviceWith(BOOTSTRAP_EMAIL).provision(bootstrapToken);

            expect(profileOf(after)).toBe('ADMIN');
            expect(after.membership?.grantedById).toBe(admin.id);
            await expect(workspaceCount()).resolves.toBe(1);
        });

        it('sem a variável configurada, ninguém é promovido (INV-0010-04)', async () => {
            const user = await serviceWith().provision(bootstrapToken);

            expect(profileOf(user)).toBeNull();
            expect(user.isPlatformAdmin).toBe(false);
        });

        it.each(['', '   '])('variável vazia (%p) também desliga o bootstrap', async (value) => {
            const user = await serviceWith(value).provision(bootstrapToken);

            expect(profileOf(user)).toBeNull();
        });

        it('não promove quem tem outro email', async () => {
            const user = await serviceWith(BOOTSTRAP_EMAIL).provision(token());

            expect(profileOf(user)).toBeNull();
            expect(user.isPlatformAdmin).toBe(false);
        });
    });

    describe('email verificado e re-vínculo (spec 0010)', () => {
        const unverifiedOwner = token({
            uid: 'uid-do-dono',
            email: BOOTSTRAP_EMAIL,
            emailVerified: false,
        });

        it('não promove o email de bootstrap sem verificação (AC-0010-14, INV-0010-10)', async () => {
            const user = await serviceWith(BOOTSTRAP_EMAIL).provision(unverifiedOwner);

            expect(profileOf(user)).toBeNull();
            expect(user.isPlatformAdmin).toBe(false);
            expect(user.emailVerified).toBe(false);
        });

        it('promove no primeiro acesso depois da verificação (AC-0010-14)', async () => {
            await serviceWith(BOOTSTRAP_EMAIL).provision(unverifiedOwner);

            const promoted = await serviceWith(BOOTSTRAP_EMAIL).provision({
                ...unverifiedOwner,
                emailVerified: true,
            });

            expect(profileOf(promoted)).toBe('ADMIN');
            expect(promoted.membership?.grantedById).toBeNull();
            expect(promoted.emailVerified).toBe(true);
        });

        it('re-vincula o UID novo à linha existente, mantendo id e perfil (AC-0010-15)', async () => {
            const original = await serviceWith().provision(token({ uid: 'uid-antigo' }));
            await makeMember(original.id, 'BILLER');

            const relinked = await serviceWith().provision(token({ uid: 'uid-novo' }));

            expect(relinked).toMatchObject({
                id: original.id,
                membership: { profile: 'BILLER' },
                firebaseUid: 'uid-novo',
            });
            await expect(users.count()).resolves.toBe(1);
            await expect(users.findOneByOrFail({ id: original.id })).resolves.toMatchObject({
                firebaseUid: 'uid-novo',
            });
        });

        it('recusa UID novo com email não verificado e não muda a linha (AC-0010-16, INV-0010-11, ERR-0010-11)', async () => {
            const original = await serviceWith().provision(token({ uid: 'uid-antigo' }));

            await expect(
                serviceWith().provision(token({ uid: 'uid-novo', emailVerified: false })),
            ).rejects.toMatchObject({ status: 403, code: 'EMAIL_NOT_VERIFIED' });

            const stored = await users.findOneByOrFail({ id: original.id });
            expect(stored.firebaseUid).toBe('uid-antigo');
            expect(stored.emailVerified).toBe(true);
            expect(stored.updatedAt).toEqual(original.updatedAt);
        });

        it('acompanha a claim email_verified do último token (AC-0010-17)', async () => {
            const first = await serviceWith().provision(token({ emailVerified: false }));
            expect(first.emailVerified).toBe(false);

            const verified = await serviceWith().provision(token({ emailVerified: true }));
            expect(verified.emailVerified).toBe(true);

            const again = await serviceWith().provision(token({ emailVerified: false }));
            expect(again.emailVerified).toBe(false);
        });

        it('re-vínculo com bootstrap verificado promove a linha existente', async () => {
            await serviceWith().provision(token({ uid: 'uid-antigo', email: BOOTSTRAP_EMAIL }));

            const relinked = await serviceWith(BOOTSTRAP_EMAIL).provision(
                token({ uid: 'uid-novo', email: BOOTSTRAP_EMAIL }),
            );

            expect(relinked).toMatchObject({
                firebaseUid: 'uid-novo',
                isPlatformAdmin: true,
                membership: { profile: 'ADMIN' },
            });
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
