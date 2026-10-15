import type { DataSource } from 'typeorm';

import { CreateWorkspaces1792200000000 } from '../../../src/platform/database/migrations/1792200000000-CreateWorkspaces';
import { createIsolatedDataSource, dropIsolatedDataSource } from '../database.helper';
import { DOMAIN_TABLES, insertDomainRows } from '../helpers/domain-rows.helper';

const SCHEMA = 'test_workspaces_migration';
const MIGRATION = 'CreateWorkspaces1792200000000';

/**
 * A migration dos espaços sobre um banco com dados das specs 0011 a 0020 (spec 0021,
 * Migration dos dados existentes). Os passos dependem uns dos outros e rodam em ordem:
 * banco vazio, banco com dados, `down` com um espaço, `down` recusado com dois.
 */
describe('migration dos espaços (spec 0021)', () => {
    let dataSource: DataSource;
    let adminId: string;
    let billerId: string;
    let pendingId: string;
    let grantedAt: Date;
    let schemaBefore: string[];

    const applied = async (): Promise<string[]> =>
        (
            (await dataSource.query('SELECT name FROM migrations ORDER BY id')) as {
                name: string;
            }[]
        ).map((row) => row.name);

    /** Volta o esquema para antes da migration dos espaços (e das que vierem depois). */
    const revertWorkspaces = async (): Promise<void> => {
        while ((await applied()).includes(MIGRATION)) {
            await dataSource.undoLastMigration();
        }
    };

    /** Roda um passo da migration num query runner próprio, fora da tabela `migrations`. */
    const migrate = async (step: 'up' | 'down'): Promise<void> => {
        const runner = dataSource.createQueryRunner();

        try {
            await new CreateWorkspaces1792200000000()[step](runner);
        } finally {
            await runner.release();
        }
    };

    const count = async (sql: string, params: unknown[] = []): Promise<number> =>
        Number(((await dataSource.query(sql, params)) as [{ n: string }])[0].n);

    const columnExists = async (table: string, column: string): Promise<boolean> =>
        (await count(
            `SELECT count(*) AS n FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
            [table, column],
        )) === 1;

    /** Constraints e índices do esquema, para comparar o antes do `up` com o depois do `down`. */
    const schemaShape = async (): Promise<string[]> => {
        const constraints = (await dataSource.query(`
            SELECT con.conrelid::regclass::text || ' ' || con.conname || ' ' ||
                   pg_get_constraintdef(con.oid) AS def
            FROM pg_constraint con
            JOIN pg_namespace n ON n.oid = con.connamespace
            WHERE n.nspname = current_schema()
        `)) as { def: string }[];
        const indexes = (await dataSource.query(`
            SELECT indexdef AS def FROM pg_indexes WHERE schemaname = current_schema()
        `)) as { def: string }[];
        const columns = (await dataSource.query(`
            SELECT table_name || '.' || column_name || ' ' || is_nullable AS def
            FROM information_schema.columns WHERE table_schema = current_schema()
        `)) as { def: string }[];

        return [...constraints, ...indexes, ...columns].map((row) => row.def).sort();
    };

    beforeAll(async () => {
        dataSource = await createIsolatedDataSource(SCHEMA);
        await dataSource.runMigrations();
        await revertWorkspaces();
    });

    afterAll(async () => {
        await dropIsolatedDataSource(dataSource, SCHEMA);
    });

    it('banco vazio não ganha espaço', async () => {
        await dataSource.runMigrations();

        await expect(count('SELECT count(*) AS n FROM workspaces')).resolves.toBe(0);

        await revertWorkspaces();
    });

    describe('banco com dados das specs 0011 a 0020', () => {
        beforeAll(async () => {
            schemaBefore = await schemaShape();
            grantedAt = new Date('2026-09-01T12:00:00.000Z');

            const user = async (
                uid: string,
                profile: string | null,
                grantedBy: string | null,
            ): Promise<string> => {
                const [row] = (await dataSource.query(
                    `INSERT INTO users (firebase_uid, email, name, profile, profile_granted_at,
                        profile_granted_by)
                     VALUES ($1, $2, $1, $3, $4, $5) RETURNING id`,
                    [uid, `${uid}@exemplo.com`, profile, profile ? grantedAt : null, grantedBy],
                )) as [{ id: string }];

                return row.id;
            };

            adminId = await user('admin', 'ADMIN', null);
            billerId = await user('biller', 'BILLER', adminId);
            pendingId = await user('pendente', null, null);

            const [bank] = (await dataSource.query(
                "INSERT INTO banks (febraban_code, name) VALUES ('260', 'Nu') RETURNING id",
            )) as [{ id: string }];
            await insertDomainRows(dataSource, { bankId: bank.id, workspaceId: null, tag: 'x' });

            await dataSource.runMigrations();
        });

        it('AC-0021-01: cria um espaço Principal', async () => {
            const workspaces = (await dataSource.query('SELECT name FROM workspaces')) as {
                name: string;
            }[];

            expect(workspaces).toEqual([{ name: 'Principal' }]);
        });

        it.each(DOMAIN_TABLES)(
            'AC-0021-01, INV-0021-01: toda linha de %s fica no Principal',
            async (table) => {
                await expect(count(`SELECT count(*) AS n FROM ${table}`)).resolves.toBeGreaterThan(
                    0,
                );
                await expect(
                    count(
                        `SELECT count(*) AS n FROM ${table}
                         WHERE workspace_id IS DISTINCT FROM
                               (SELECT id FROM workspaces WHERE name = 'Principal')`,
                    ),
                ).resolves.toBe(0);
            },
        );

        it.each(DOMAIN_TABLES)('INV-0021-01: %s.workspace_id é NOT NULL', async (table) => {
            const [column] = (await dataSource.query(
                `SELECT is_nullable FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = $1
                   AND column_name = 'workspace_id'`,
                [table],
            )) as [{ is_nullable: string }];

            expect(column.is_nullable).toBe('NO');
        });

        it('AC-0021-01: cada usuário com perfil vira membro com o mesmo perfil, data e quem concedeu', async () => {
            const members = (await dataSource.query(
                `SELECT m.user_id, m.profile, m.granted_at, m.granted_by, w.name
                 FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
                 ORDER BY m.profile`,
            )) as {
                user_id: string;
                profile: string;
                granted_at: Date;
                granted_by: string | null;
                name: string;
            }[];

            expect(members).toEqual([
                {
                    user_id: adminId,
                    profile: 'ADMIN',
                    granted_at: grantedAt,
                    granted_by: null,
                    name: 'Principal',
                },
                {
                    user_id: billerId,
                    profile: 'BILLER',
                    granted_at: grantedAt,
                    granted_by: adminId,
                    name: 'Principal',
                },
            ]);
        });

        it('AC-0021-01: os ADMIN viram admin da plataforma, e só eles', async () => {
            const users = (await dataSource.query(
                'SELECT id, is_platform_admin FROM users ORDER BY email',
            )) as { id: string; is_platform_admin: boolean }[];

            expect(users).toEqual([
                { id: adminId, is_platform_admin: true },
                { id: billerId, is_platform_admin: false },
                { id: pendingId, is_platform_admin: false },
            ]);
        });

        it('AC-0021-01: o perfil sai de users', async () => {
            for (const column of ['profile', 'profile_granted_at', 'profile_granted_by']) {
                await expect(columnExists('users', column)).resolves.toBe(false);
            }
        });

        it('AC-0021-02: o down devolve o esquema e os perfis em users', async () => {
            await migrate('down');

            expect(await schemaShape()).toEqual(schemaBefore);

            const users = (await dataSource.query(
                `SELECT id, profile, profile_granted_at, profile_granted_by
                 FROM users ORDER BY email`,
            )) as unknown[];
            expect(users).toEqual([
                {
                    id: adminId,
                    profile: 'ADMIN',
                    profile_granted_at: grantedAt,
                    profile_granted_by: null,
                },
                {
                    id: billerId,
                    profile: 'BILLER',
                    profile_granted_at: grantedAt,
                    profile_granted_by: adminId,
                },
                {
                    id: pendingId,
                    profile: null,
                    profile_granted_at: null,
                    profile_granted_by: null,
                },
            ]);

            // Deixa a migration aplicada de novo, como estava, para o passo seguinte.
            await migrate('up');
        });

        it('AC-0021-02: com dois espaços, o down falha sem alterar nada', async () => {
            await dataSource.query("INSERT INTO workspaces (name) VALUES ('Outro')");
            const before = await schemaShape();

            await expect(migrate('down')).rejects.toThrow(/more than one workspace/);

            expect(await schemaShape()).toEqual(before);
            await expect(count('SELECT count(*) AS n FROM workspaces')).resolves.toBe(2);
            await expect(count('SELECT count(*) AS n FROM workspace_members')).resolves.toBe(2);
            await expect(columnExists('users', 'profile')).resolves.toBe(false);
        });
    });
});
