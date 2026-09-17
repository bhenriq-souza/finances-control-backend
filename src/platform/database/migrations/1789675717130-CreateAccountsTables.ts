import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tabelas da spec 0011.
 *
 * Gerada por `migration:generate` e corrigida à mão em dois pontos, que o gerador
 * não tem como inferir: o default da PK é `gen_random_uuid()`, nativo no
 * PostgreSQL 13+, e não `uuid_generate_v4()`, que exigiria a extensão
 * `uuid-ossp`; e os triggers de `updated_at` são declarados (spec 0003).
 *
 * Desta vez os defaults de `created_at`/`updated_at` vieram corretos, porque as
 * entidades os declaram — a lição que a T-0010-01 deixou.
 */
export class CreateAccountsTables1789675717130 implements MigrationInterface {
    name = 'CreateAccountsTables1789675717130';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "banks" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "febraban_code" text NOT NULL,
                "name" text NOT NULL,
                "archived_at" timestamptz,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "pk_banks" PRIMARY KEY ("id"),
                CONSTRAINT "uq_banks_febraban_code" UNIQUE ("febraban_code"),
                CONSTRAINT "ck_banks_febraban_code" CHECK (febraban_code ~ '^[0-9]{3}$')
            )
        `);

        await queryRunner.query(`
            CREATE TABLE "bank_accounts" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "bank_id" uuid NOT NULL,
                "type" text NOT NULL,
                "account_number" text NOT NULL,
                "description" text NOT NULL,
                "opening_balance_cents" numeric(14,2) NOT NULL,
                "current_balance_cents" numeric(14,2) NOT NULL,
                "overdraft_limit_cents" numeric(14,2) NOT NULL DEFAULT '0',
                "archived_at" timestamptz,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "pk_bank_accounts" PRIMARY KEY ("id"),
                CONSTRAINT "uq_bank_accounts_bank_id_account_number" UNIQUE ("bank_id", "account_number"),
                CONSTRAINT "ck_bank_accounts_type" CHECK (type IN ('CHECKING', 'SAVINGS', 'INVESTMENT')),
                CONSTRAINT "ck_bank_accounts_overdraft_limit" CHECK (overdraft_limit_cents >= 0)
            )
        `);

        await queryRunner.query(`
            CREATE TABLE "credit_cards" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "bank_id" uuid NOT NULL,
                "name" text NOT NULL,
                "credit_limit_cents" numeric(14,2) NOT NULL,
                "available_limit_cents" numeric(14,2) NOT NULL,
                "closing_day" integer NOT NULL,
                "due_day" integer NOT NULL,
                "archived_at" timestamptz,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "pk_credit_cards" PRIMARY KEY ("id"),
                CONSTRAINT "uq_credit_cards_bank_id_name" UNIQUE ("bank_id", "name"),
                CONSTRAINT "ck_credit_cards_credit_limit" CHECK (credit_limit_cents > 0),
                CONSTRAINT "ck_credit_cards_closing_day" CHECK (closing_day BETWEEN 1 AND 31),
                CONSTRAINT "ck_credit_cards_due_day" CHECK (due_day BETWEEN 1 AND 31)
            )
        `);

        await queryRunner.query(`
            ALTER TABLE "bank_accounts"
            ADD CONSTRAINT "fk_bank_accounts_bank_id"
            FOREIGN KEY ("bank_id") REFERENCES "banks"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "credit_cards"
            ADD CONSTRAINT "fk_credit_cards_bank_id"
            FOREIGN KEY ("bank_id") REFERENCES "banks"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);

        for (const table of ['banks', 'bank_accounts', 'credit_cards']) {
            await queryRunner.query(`
                CREATE TRIGGER "set_${table}_updated_at"
                BEFORE UPDATE ON "${table}"
                FOR EACH ROW EXECUTE FUNCTION set_updated_at()
            `);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of ['credit_cards', 'bank_accounts', 'banks']) {
            await queryRunner.query(`
                DROP TRIGGER IF EXISTS "set_${table}_updated_at" ON "${table}"
            `);
        }

        await queryRunner.query(`
            ALTER TABLE "credit_cards" DROP CONSTRAINT "fk_credit_cards_bank_id"
        `);
        await queryRunner.query(`
            ALTER TABLE "bank_accounts" DROP CONSTRAINT "fk_bank_accounts_bank_id"
        `);

        await queryRunner.query('DROP TABLE "credit_cards"');
        await queryRunner.query('DROP TABLE "bank_accounts"');
        await queryRunner.query('DROP TABLE "banks"');
    }
}
