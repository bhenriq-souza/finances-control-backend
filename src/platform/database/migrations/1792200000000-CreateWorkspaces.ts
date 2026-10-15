import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Domain tables that belong to a workspace (spec 0021, Modelo). */
const DOMAIN_TABLES = [
    'bank_accounts',
    'credit_cards',
    'expense_recurrences',
    'expenses',
    'earning_recurrences',
    'earnings',
    'credit_card_statements',
    'credit_card_statement_payments',
    'credit_card_refunds',
    'bank_transfers',
] as const;

/** Tables referenced by another domain table: they gain `UNIQUE (workspace_id, id)`. */
const REFERENCED_TABLES = [
    'bank_accounts',
    'credit_cards',
    'expense_recurrences',
    'expenses',
    'earning_recurrences',
    'credit_card_statements',
] as const;

type ForeignKey = {
    table: string;
    column: string;
    references: string;
    /** `RESTRICT` everywhere but the refund's expense, which the spec 0013 nulls on delete. */
    onDelete: 'RESTRICT' | 'SET NULL';
};

/**
 * Every foreign key between two domain tables. Each one becomes composite with `workspace_id`
 * (INV-0021-04) and keeps its name, so the error mapping of the modules does not change.
 */
const DOMAIN_FOREIGN_KEYS: ForeignKey[] = [
    {
        table: 'credit_cards',
        column: 'payment_bank_account_id',
        references: 'bank_accounts',
        onDelete: 'RESTRICT',
    },
    {
        table: 'expenses',
        column: 'bank_account_id',
        references: 'bank_accounts',
        onDelete: 'RESTRICT',
    },
    {
        table: 'expenses',
        column: 'credit_card_id',
        references: 'credit_cards',
        onDelete: 'RESTRICT',
    },
    {
        table: 'expenses',
        column: 'recurrence_id',
        references: 'expense_recurrences',
        onDelete: 'RESTRICT',
    },
    {
        table: 'expense_recurrences',
        column: 'bank_account_id',
        references: 'bank_accounts',
        onDelete: 'RESTRICT',
    },
    {
        table: 'expense_recurrences',
        column: 'credit_card_id',
        references: 'credit_cards',
        onDelete: 'RESTRICT',
    },
    {
        table: 'earnings',
        column: 'bank_account_id',
        references: 'bank_accounts',
        onDelete: 'RESTRICT',
    },
    {
        table: 'earnings',
        column: 'recurrence_id',
        references: 'earning_recurrences',
        onDelete: 'RESTRICT',
    },
    {
        table: 'earning_recurrences',
        column: 'bank_account_id',
        references: 'bank_accounts',
        onDelete: 'RESTRICT',
    },
    {
        table: 'credit_card_statements',
        column: 'credit_card_id',
        references: 'credit_cards',
        onDelete: 'RESTRICT',
    },
    {
        table: 'credit_card_statement_payments',
        column: 'statement_id',
        references: 'credit_card_statements',
        onDelete: 'RESTRICT',
    },
    {
        table: 'credit_card_statement_payments',
        column: 'bank_account_id',
        references: 'bank_accounts',
        onDelete: 'RESTRICT',
    },
    {
        table: 'credit_card_statement_payments',
        column: 'credit_card_id',
        references: 'credit_cards',
        onDelete: 'RESTRICT',
    },
    {
        table: 'credit_card_refunds',
        column: 'credit_card_id',
        references: 'credit_cards',
        onDelete: 'RESTRICT',
    },
    {
        table: 'credit_card_refunds',
        column: 'expense_id',
        references: 'expenses',
        onDelete: 'SET NULL',
    },
    {
        table: 'bank_transfers',
        column: 'from_bank_account_id',
        references: 'bank_accounts',
        onDelete: 'RESTRICT',
    },
    {
        table: 'bank_transfers',
        column: 'to_bank_account_id',
        references: 'bank_accounts',
        onDelete: 'RESTRICT',
    },
];

/** Unique constraints that become per workspace; the names stay. */
const PER_WORKSPACE_UNIQUES = [
    {
        table: 'bank_accounts',
        name: 'uq_bank_accounts_bank_id_account_number',
        columns: ['bank_id', 'account_number'],
    },
    { table: 'credit_cards', name: 'uq_credit_cards_bank_id_name', columns: ['bank_id', 'name'] },
] as const;

const fkName = (fk: ForeignKey): string => `fk_${fk.table}_${fk.column}`;

const quoted = (columns: readonly string[]): string => columns.map((c) => `"${c}"`).join(', ');

/**
 * Workspaces and members (spec 0021): every domain row moves into a single `Principal`
 * workspace, the current profiles become memberships and the `ADMIN`s become platform admins.
 * The `down` goes back only from one workspace: merging several would lose the isolation
 * without warning, so it raises instead.
 */
export class CreateWorkspaces1792200000000 implements MigrationInterface {
    name = 'CreateWorkspaces1792200000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        /* 1. new tables and the platform admin flag */
        await queryRunner.query(`
            CREATE TABLE "workspaces" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "name" text NOT NULL,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "pk_workspaces" PRIMARY KEY ("id"),
                CONSTRAINT "ck_workspaces_name"
                    CHECK (char_length(name) BETWEEN 1 AND 80 AND name = btrim(name))
            )
        `);
        await queryRunner.query(`
            CREATE TRIGGER "set_workspaces_updated_at"
            BEFORE UPDATE ON "workspaces"
            FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        `);
        await queryRunner.query(`
            CREATE TABLE "workspace_members" (
                "workspace_id" uuid NOT NULL,
                "user_id" uuid NOT NULL,
                "profile" text NOT NULL,
                "granted_at" timestamptz NOT NULL,
                "granted_by" uuid,
                CONSTRAINT "pk_workspace_members" PRIMARY KEY ("workspace_id", "user_id"),
                CONSTRAINT "uq_workspace_members_user_id" UNIQUE ("user_id"),
                CONSTRAINT "ck_workspace_members_profile"
                    CHECK (profile IN ('ADMIN', 'BILLER', 'VIEWER')),
                CONSTRAINT "fk_workspace_members_workspace_id" FOREIGN KEY ("workspace_id")
                    REFERENCES "workspaces"("id") ON DELETE RESTRICT,
                CONSTRAINT "fk_workspace_members_user_id" FOREIGN KEY ("user_id")
                    REFERENCES "users"("id") ON DELETE CASCADE,
                CONSTRAINT "fk_workspace_members_granted_by" FOREIGN KEY ("granted_by")
                    REFERENCES "users"("id") ON DELETE RESTRICT
            )
        `);
        await queryRunner.query(
            'ALTER TABLE "users" ADD "is_platform_admin" boolean NOT NULL DEFAULT false',
        );

        /* 2. one `Principal` workspace, only when there is something to put in it */
        const hasDomainRows = DOMAIN_TABLES.map(
            (table) => `EXISTS (SELECT 1 FROM "${table}")`,
        ).join(' OR ');
        await queryRunner.query(`
            INSERT INTO "workspaces" ("name")
            SELECT 'Principal'
            WHERE EXISTS (SELECT 1 FROM "users" WHERE "profile" IS NOT NULL) OR ${hasDomainRows}
        `);

        /* 3. profiles become memberships; 4. ADMINs become platform admins */
        await queryRunner.query(`
            INSERT INTO "workspace_members"
                ("workspace_id", "user_id", "profile", "granted_at", "granted_by")
            SELECT w."id", u."id", u."profile", COALESCE(u."profile_granted_at", now()),
                   u."profile_granted_by"
            FROM "users" u CROSS JOIN "workspaces" w
            WHERE u."profile" IS NOT NULL
        `);
        // The flag is not a change the user made: `updated_at` stays as it was.
        await queryRunner.query('ALTER TABLE "users" DISABLE TRIGGER "set_users_updated_at"');
        await queryRunner.query(
            'UPDATE "users" SET "is_platform_admin" = true WHERE "profile" = \'ADMIN\'',
        );
        await queryRunner.query('ALTER TABLE "users" ENABLE TRIGGER "set_users_updated_at"');

        /* 5. workspace_id on every domain table, backfilled before NOT NULL */
        for (const table of DOMAIN_TABLES) {
            await queryRunner.query(`ALTER TABLE "${table}" ADD "workspace_id" uuid`);
            await queryRunner.query(
                `ALTER TABLE "${table}" DISABLE TRIGGER "set_${table}_updated_at"`,
            );
            await queryRunner.query(
                `UPDATE "${table}" SET "workspace_id" = (SELECT "id" FROM "workspaces" LIMIT 1)`,
            );
            await queryRunner.query(
                `ALTER TABLE "${table}" ENABLE TRIGGER "set_${table}_updated_at"`,
            );
            await queryRunner.query(
                `ALTER TABLE "${table}" ALTER COLUMN "workspace_id" SET NOT NULL`,
            );
            await queryRunner.query(`
                ALTER TABLE "${table}" ADD CONSTRAINT "fk_${table}_workspace_id"
                FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT
            `);
            await queryRunner.query(
                `CREATE INDEX "idx_${table}_workspace_id" ON "${table}" ("workspace_id")`,
            );
        }

        for (const table of REFERENCED_TABLES) {
            await queryRunner.query(`
                ALTER TABLE "${table}" ADD CONSTRAINT "uq_${table}_workspace_id_id"
                UNIQUE ("workspace_id", "id")
            `);
        }

        for (const fk of DOMAIN_FOREIGN_KEYS) {
            // `SET NULL (column)` nulls only the reference: `workspace_id` is NOT NULL.
            const onDelete = fk.onDelete === 'SET NULL' ? `SET NULL ("${fk.column}")` : fk.onDelete;

            await queryRunner.query(`ALTER TABLE "${fk.table}" DROP CONSTRAINT "${fkName(fk)}"`);
            await queryRunner.query(`
                ALTER TABLE "${fk.table}" ADD CONSTRAINT "${fkName(fk)}"
                FOREIGN KEY ("workspace_id", "${fk.column}")
                REFERENCES "${fk.references}"("workspace_id", "id")
                MATCH SIMPLE ON DELETE ${onDelete}
            `);
        }

        for (const unique of PER_WORKSPACE_UNIQUES) {
            await queryRunner.query(
                `ALTER TABLE "${unique.table}" DROP CONSTRAINT "${unique.name}"`,
            );
            await queryRunner.query(`
                ALTER TABLE "${unique.table}" ADD CONSTRAINT "${unique.name}"
                UNIQUE ("workspace_id", ${quoted(unique.columns)})
            `);
        }

        /* 6. the profile leaves users */
        await queryRunner.query(
            'ALTER TABLE "users" DROP CONSTRAINT "fk_users_profile_granted_by"',
        );
        await queryRunner.query('ALTER TABLE "users" DROP CONSTRAINT "ck_users_profile"');
        await queryRunner.query(`
            ALTER TABLE "users"
            DROP COLUMN "profile",
            DROP COLUMN "profile_granted_at",
            DROP COLUMN "profile_granted_by"
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DO $$
            BEGIN
                IF (SELECT count(*) FROM "workspaces") > 1 THEN
                    RAISE EXCEPTION 'cannot revert workspaces: more than one workspace exists';
                END IF;
            END
            $$
        `);

        /* the profile goes back to users, from the membership */
        await queryRunner.query(`
            ALTER TABLE "users"
            ADD "profile" text,
            ADD "profile_granted_at" timestamptz,
            ADD "profile_granted_by" uuid
        `);
        await queryRunner.query('ALTER TABLE "users" DISABLE TRIGGER "set_users_updated_at"');
        await queryRunner.query(`
            UPDATE "users" u
            SET "profile" = m."profile",
                "profile_granted_at" = m."granted_at",
                "profile_granted_by" = m."granted_by"
            FROM "workspace_members" m
            WHERE m."user_id" = u."id"
        `);
        await queryRunner.query('ALTER TABLE "users" ENABLE TRIGGER "set_users_updated_at"');
        await queryRunner.query(`
            ALTER TABLE "users" ADD CONSTRAINT "ck_users_profile"
            CHECK (profile IN ('ADMIN', 'BILLER', 'VIEWER'))
        `);
        await queryRunner.query(`
            ALTER TABLE "users" ADD CONSTRAINT "fk_users_profile_granted_by"
            FOREIGN KEY ("profile_granted_by") REFERENCES "users"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);

        for (const unique of PER_WORKSPACE_UNIQUES) {
            await queryRunner.query(
                `ALTER TABLE "${unique.table}" DROP CONSTRAINT "${unique.name}"`,
            );
            await queryRunner.query(`
                ALTER TABLE "${unique.table}" ADD CONSTRAINT "${unique.name}"
                UNIQUE (${quoted(unique.columns)})
            `);
        }

        for (const fk of DOMAIN_FOREIGN_KEYS) {
            await queryRunner.query(`ALTER TABLE "${fk.table}" DROP CONSTRAINT "${fkName(fk)}"`);
            await queryRunner.query(`
                ALTER TABLE "${fk.table}" ADD CONSTRAINT "${fkName(fk)}"
                FOREIGN KEY ("${fk.column}") REFERENCES "${fk.references}"("id")
                ON DELETE ${fk.onDelete} ON UPDATE NO ACTION
            `);
        }

        for (const table of REFERENCED_TABLES) {
            await queryRunner.query(
                `ALTER TABLE "${table}" DROP CONSTRAINT "uq_${table}_workspace_id_id"`,
            );
        }

        for (const table of DOMAIN_TABLES) {
            await queryRunner.query(`DROP INDEX "idx_${table}_workspace_id"`);
            await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "workspace_id"`);
        }

        await queryRunner.query('ALTER TABLE "users" DROP COLUMN "is_platform_admin"');
        await queryRunner.query('DROP TABLE "workspace_members"');
        await queryRunner.query(
            'DROP TRIGGER IF EXISTS "set_workspaces_updated_at" ON "workspaces"',
        );
        await queryRunner.query('DROP TABLE "workspaces"');
    }
}
