import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tabela `user_avatars` da spec 0010 (revisão de 2026-10-13): a foto do usuário,
 * uma linha por quem tem foto. A PK é o próprio `user_id`, e a FK cai em cascata
 * com o usuário — a foto não tem sentido sem o dono. Só `updated_at`, sem
 * `created_at`, como a spec fixa: é o `updated_at` que o `UserResponse` publica.
 */
export class CreateUserAvatarsTable1792000000000 implements MigrationInterface {
    name = 'CreateUserAvatarsTable1792000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "user_avatars" (
                "user_id" uuid NOT NULL,
                "content" bytea NOT NULL,
                "content_type" text NOT NULL,
                "size_bytes" integer NOT NULL,
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "pk_user_avatars" PRIMARY KEY ("user_id"),
                CONSTRAINT "ck_user_avatars_content_type"
                    CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
                CONSTRAINT "ck_user_avatars_size_bytes" CHECK (size_bytes BETWEEN 1 AND 524288)
            )
        `);

        await queryRunner.query(`
            ALTER TABLE "user_avatars"
            ADD CONSTRAINT "fk_user_avatars_user_id"
            FOREIGN KEY ("user_id") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            CREATE TRIGGER "set_user_avatars_updated_at"
            BEFORE UPDATE ON "user_avatars"
            FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'DROP TRIGGER IF EXISTS "set_user_avatars_updated_at" ON "user_avatars"',
        );
        await queryRunner.query(
            'ALTER TABLE "user_avatars" DROP CONSTRAINT "fk_user_avatars_user_id"',
        );
        await queryRunner.query('DROP TABLE "user_avatars"');
    }
}
