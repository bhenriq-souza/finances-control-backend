import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Coluna `users.email_verified` da spec 0010: espelha a claim `email_verified`
 * do último token. Linhas existentes ficam `false` e são corrigidas no próximo
 * acesso do usuário.
 */
export class AddUserEmailVerified1791900000000 implements MigrationInterface {
    name = 'AddUserEmailVerified1791900000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'ALTER TABLE "users" ADD "email_verified" boolean NOT NULL DEFAULT false',
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "users" DROP COLUMN "email_verified"');
    }
}
