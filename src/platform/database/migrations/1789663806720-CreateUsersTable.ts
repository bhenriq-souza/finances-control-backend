import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tabela `users` da spec 0010.
 *
 * Gerada por `migration:generate` e corrigida à mão em três pontos, como manda a
 * spec 0003: o default da PK é `gen_random_uuid()` (nativo no PostgreSQL 13+) e
 * não `uuid_generate_v4()`, que exigiria a extensão `uuid-ossp`; `created_at` e
 * `updated_at` ganham `default now()`, sem o qual um INSERT falharia, já que o
 * ORM não escreve essas colunas; e o trigger de `updated_at` é declarado, que o
 * gerador não tem como inferir.
 */
export class CreateUsersTable1789663806720 implements MigrationInterface {
    name = 'CreateUsersTable1789663806720';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "users" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "firebase_uid" text NOT NULL,
                "email" text NOT NULL,
                "name" text NOT NULL,
                "profile" text,
                "profile_granted_at" timestamptz,
                "profile_granted_by" uuid,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "pk_users" PRIMARY KEY ("id"),
                CONSTRAINT "uq_users_firebase_uid" UNIQUE ("firebase_uid"),
                CONSTRAINT "uq_users_email" UNIQUE ("email"),
                CONSTRAINT "ck_users_profile" CHECK (profile IN ('ADMIN', 'BILLER', 'VIEWER'))
            )
        `);

        await queryRunner.query(`
            ALTER TABLE "users"
            ADD CONSTRAINT "fk_users_profile_granted_by"
            FOREIGN KEY ("profile_granted_by") REFERENCES "users"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            CREATE TRIGGER "set_users_updated_at"
            BEFORE UPDATE ON "users"
            FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TRIGGER IF EXISTS "set_users_updated_at" ON "users"');
        await queryRunner.query(
            'ALTER TABLE "users" DROP CONSTRAINT "fk_users_profile_granted_by"',
        );
        await queryRunner.query('DROP TABLE "users"');
    }
}
