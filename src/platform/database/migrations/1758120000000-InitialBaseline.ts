import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline da spec 0003. Não cria tabela de domínio de propósito: o schema de
 * negócio nasce fatia a fatia nas specs 0010+, junto das entidades que o
 * justificam. O que entra aqui é só o que toda tabela futura vai usar.
 *
 * `set_updated_at()` mantém a coluna `updated_at` no banco, e não no ORM, para
 * valer também em escrita fora dele — importação CSV, correção manual, migration.
 */
export class InitialBaseline1758120000000 implements MigrationInterface {
    name = 'InitialBaseline1758120000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                NEW.updated_at = now();
                RETURN NEW;
            END;
            $$;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP FUNCTION IF EXISTS set_updated_at();');
    }
}
