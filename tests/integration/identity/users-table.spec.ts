import type { DataSource, Repository } from 'typeorm';

import { User } from '../../../src/identity/user.entity';
import { withMembership } from '../../../src/identity/membership';
import { WorkspaceMember } from '../../../src/identity/workspace-member.entity';
import { normalizeEmail } from '../../../src/identity/email';
import { createIsolatedDataSource, dropIsolatedDataSource } from '../database.helper';

const SCHEMA = 'test_identity_users';

const newUser = (overrides: Partial<User> = {}): Partial<User> => ({
    firebaseUid: `uid-${Math.random().toString(36).slice(2)}`,
    email: normalizeEmail(`User-${Math.random().toString(36).slice(2)}@Exemplo.com`),
    name: 'Pessoa de Teste',
    ...overrides,
});

describe('tabela users (spec 0010)', () => {
    let dataSource: DataSource;
    let users: Repository<User>;

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

    /** O perfil mora no membro do espaço (spec 0021). */
    const grant = async (
        userId: string,
        profile: string,
        grantedById: string | null = null,
    ): Promise<void> => {
        const [workspace] = (await dataSource.query(
            "INSERT INTO workspaces (name) VALUES ('Casa') RETURNING id",
        )) as [{ id: string }];

        await dataSource.query(
            `INSERT INTO workspace_members (workspace_id, user_id, profile, granted_at, granted_by)
             VALUES ($1, $2, $3, now(), $4)`,
            [workspace.id, userId, profile, grantedById],
        );
    };

    describe('migration', () => {
        it('cria a tabela com o trigger de updated_at', async () => {
            const [trigger] = await dataSource.query<{ tgname: string }[]>(`
                SELECT t.tgname
                FROM pg_trigger t
                JOIN pg_class c ON c.oid = t.tgrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relname = 'users' AND n.nspname = current_schema() AND NOT t.tgisinternal
            `);

            expect(trigger?.tgname).toBe('set_users_updated_at');
        });

        it('nomeia as constraints pela convenção da spec 0003', async () => {
            const rows = await dataSource.query<{ conname: string }[]>(`
                SELECT con.conname
                FROM pg_constraint con
                JOIN pg_class c ON c.oid = con.conrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relname = 'users' AND n.nspname = current_schema()
                ORDER BY con.conname
            `);

            // O perfil e quem o concedeu saíram para `workspace_members` (spec 0021).
            expect(rows.map((row) => row.conname)).toEqual([
                'pk_users',
                'uq_users_email',
                'uq_users_firebase_uid',
            ]);
        });
    });

    describe('gravação', () => {
        it('nasce sem perfil, com id e timestamps do banco', async () => {
            const saved = await users.save(users.create(newUser()));
            const stored = await users.findOneByOrFail({ id: saved.id });

            expect(stored.id).toMatch(/^[0-9a-f-]{36}$/);
            expect(stored.isPlatformAdmin).toBe(false);
            await expect(
                dataSource.getRepository(WorkspaceMember).exists({ where: { userId: saved.id } }),
            ).resolves.toBe(false);
            expect(stored.createdAt).toBeInstanceOf(Date);
            expect(stored.updatedAt).toBeInstanceOf(Date);
        });

        it('recusa email repetido, mesmo vindo de variação de caixa (AC-0010-11)', async () => {
            await users.save(users.create(newUser({ email: normalizeEmail('Bruno@Exemplo.com') })));

            await expect(
                users.save(
                    users.create(newUser({ email: normalizeEmail('  bruno@exemplo.COM ') })),
                ),
            ).rejects.toThrow(/uq_users_email/);
        });

        it('recusa firebase_uid repetido', async () => {
            await users.save(users.create(newUser({ firebaseUid: 'uid-repetido' })));

            await expect(
                users.save(users.create(newUser({ firebaseUid: 'uid-repetido' }))),
            ).rejects.toThrow(/uq_users_firebase_uid/);
        });

        it.each(['ADMIN', 'BILLER', 'VIEWER'] as const)('aceita o perfil %s', async (profile) => {
            const saved = await users.save(users.create(newUser()));
            await grant(saved.id, profile);

            const stored = await withMembership(
                dataSource.manager,
                await users.findOneByOrFail({ id: saved.id }),
            );
            expect(stored.membership?.profile).toBe(profile);
        });

        it('recusa perfil fora do enum', async () => {
            const saved = await users.save(users.create(newUser()));

            await expect(grant(saved.id, 'OWNER')).rejects.toThrow(/ck_workspace_members_profile/);
        });
    });

    describe('trigger de updated_at (spec 0003)', () => {
        it('avança updated_at mesmo em escrita fora do ORM', async () => {
            const saved = await users.save(users.create(newUser()));
            const before = (await users.findOneByOrFail({ id: saved.id })).updatedAt;

            await dataSource.query('UPDATE users SET name = $1 WHERE id = $2', [
                'Outro Nome',
                saved.id,
            ]);

            const after = (await users.findOneByOrFail({ id: saved.id })).updatedAt;
            expect(after.getTime()).toBeGreaterThan(before.getTime());
        });
    });

    describe('quem concedeu o perfil', () => {
        it('aponta para outro usuário', async () => {
            const admin = await users.save(users.create(newUser()));
            const granted = await users.save(users.create(newUser()));
            await grant(granted.id, 'VIEWER', admin.id);

            const stored = await withMembership(
                dataSource.manager,
                await users.findOneByOrFail({ id: granted.id }),
            );
            expect(stored.membership?.grantedById).toBe(admin.id);
        });

        it('impede apagar quem concedeu, por on delete restrict', async () => {
            const admin = await users.save(users.create(newUser()));
            const granted = await users.save(users.create(newUser()));
            await grant(granted.id, 'VIEWER', admin.id);

            await expect(users.delete({ id: admin.id })).rejects.toThrow(
                /fk_workspace_members_granted_by/,
            );
        });
    });
});
