import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Série de receitas `FIXED` (spec 0017): `earning_recurrences` e `earnings.recurrence_id`.
 * `uq_earnings_recurrence_id_occurred_on` torna a geração idempotente por construção.
 * Escrita à mão, como as demais (PK `gen_random_uuid()`, trigger de `updated_at`).
 *
 * Receitas `FIXED` anteriores à série ganham, cada uma, uma série própria encerrada na
 * própria data (`ends_on = occurred_on`): `ck_earnings_recurrence` vale para todas as
 * linhas e a extensão não gera nada a partir delas.
 */
export class CreateEarningRecurrences1791800000000 implements MigrationInterface {
    name = 'CreateEarningRecurrences1791800000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "earning_recurrences" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "description" text NOT NULL,
                "earning_type_id" uuid NOT NULL,
                "amount_cents" numeric(14,2) NOT NULL,
                "day_of_month" integer NOT NULL,
                "bank_account_id" uuid NOT NULL,
                "notes" text,
                "starts_on" date NOT NULL,
                "ends_on" date,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "pk_earning_recurrences" PRIMARY KEY ("id"),
                CONSTRAINT "ck_earning_recurrences_amount" CHECK (amount_cents > 0),
                CONSTRAINT "ck_earning_recurrences_day_of_month" CHECK (day_of_month BETWEEN 1 AND 31),
                CONSTRAINT "ck_earning_recurrences_ends_on" CHECK (ends_on IS NULL OR ends_on >= starts_on)
            )
        `);
        await queryRunner.query(`
            ALTER TABLE "earning_recurrences"
            ADD CONSTRAINT "fk_earning_recurrences_earning_type_id"
            FOREIGN KEY ("earning_type_id") REFERENCES "earning_types"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "earning_recurrences"
            ADD CONSTRAINT "fk_earning_recurrences_bank_account_id"
            FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
        await queryRunner.query(
            'CREATE INDEX "idx_earning_recurrences_ends_on" ON "earning_recurrences" ("ends_on")',
        );
        await queryRunner.query(`
            CREATE TRIGGER "set_earning_recurrences_updated_at"
            BEFORE UPDATE ON "earning_recurrences"
            FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        `);

        await queryRunner.query('ALTER TABLE "earnings" ADD COLUMN "recurrence_id" uuid');
        await queryRunner.query(`
            ALTER TABLE "earnings"
            ADD CONSTRAINT "fk_earnings_recurrence_id"
            FOREIGN KEY ("recurrence_id") REFERENCES "earning_recurrences"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);

        // Backfill: uma série encerrada por `FIXED` já existente.
        await queryRunner.query(`
            ALTER TABLE "earnings" ADD COLUMN "legacy_recurrence_id" uuid
        `);
        await queryRunner.query(`
            UPDATE "earnings" SET "legacy_recurrence_id" = gen_random_uuid() WHERE "kind" = 'FIXED'
        `);
        await queryRunner.query(`
            INSERT INTO "earning_recurrences" (
                "id", "description", "earning_type_id", "amount_cents", "day_of_month",
                "bank_account_id", "notes", "starts_on", "ends_on"
            )
            SELECT "legacy_recurrence_id", "description", "earning_type_id", "amount_cents",
                   EXTRACT(DAY FROM "occurred_on")::int, "bank_account_id",
                   "notes", "occurred_on", "occurred_on"
            FROM "earnings" WHERE "kind" = 'FIXED'
        `);
        await queryRunner.query(`
            UPDATE "earnings" SET "recurrence_id" = "legacy_recurrence_id" WHERE "kind" = 'FIXED'
        `);
        await queryRunner.query('ALTER TABLE "earnings" DROP COLUMN "legacy_recurrence_id"');

        await queryRunner.query(`
            ALTER TABLE "earnings"
            ADD CONSTRAINT "ck_earnings_recurrence"
            CHECK ((recurrence_id IS NOT NULL) = (kind = 'FIXED'))
        `);
        await queryRunner.query(`
            ALTER TABLE "earnings"
            ADD CONSTRAINT "uq_earnings_recurrence_id_occurred_on" UNIQUE ("recurrence_id", "occurred_on")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'ALTER TABLE "earnings" DROP CONSTRAINT "uq_earnings_recurrence_id_occurred_on"',
        );
        await queryRunner.query('ALTER TABLE "earnings" DROP CONSTRAINT "ck_earnings_recurrence"');
        await queryRunner.query(
            'ALTER TABLE "earnings" DROP CONSTRAINT "fk_earnings_recurrence_id"',
        );
        await queryRunner.query('ALTER TABLE "earnings" DROP COLUMN "recurrence_id"');
        await queryRunner.query(
            'DROP TRIGGER IF EXISTS "set_earning_recurrences_updated_at" ON "earning_recurrences"',
        );
        await queryRunner.query('DROP TABLE "earning_recurrences"');
    }
}
