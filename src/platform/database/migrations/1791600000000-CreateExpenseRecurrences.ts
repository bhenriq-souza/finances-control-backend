import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Série de despesas `FIXED` (spec 0017): `expense_recurrences` e `expenses.recurrence_id`.
 * `uq_expenses_recurrence_id_occurred_on` torna a geração idempotente por construção.
 * Escrita à mão, como as demais (PK `gen_random_uuid()`, trigger de `updated_at`).
 *
 * Despesas `FIXED` anteriores à série ganham, cada uma, uma série própria encerrada na
 * própria data (`ends_on = occurred_on`): `ck_expenses_recurrence` vale para todas as
 * linhas e a extensão não gera nada a partir delas.
 */
export class CreateExpenseRecurrences1791600000000 implements MigrationInterface {
    name = 'CreateExpenseRecurrences1791600000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "expense_recurrences" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "description" text NOT NULL,
                "expense_type_id" uuid NOT NULL,
                "amount_cents" numeric(14,2) NOT NULL,
                "day_of_month" integer NOT NULL,
                "bank_account_id" uuid,
                "credit_card_id" uuid,
                "notes" text,
                "starts_on" date NOT NULL,
                "ends_on" date,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "pk_expense_recurrences" PRIMARY KEY ("id"),
                CONSTRAINT "ck_expense_recurrences_amount" CHECK (amount_cents > 0),
                CONSTRAINT "ck_expense_recurrences_day_of_month" CHECK (day_of_month BETWEEN 1 AND 31),
                CONSTRAINT "ck_expense_recurrences_owner" CHECK ((bank_account_id IS NULL) <> (credit_card_id IS NULL)),
                CONSTRAINT "ck_expense_recurrences_ends_on" CHECK (ends_on IS NULL OR ends_on >= starts_on)
            )
        `);
        await queryRunner.query(`
            ALTER TABLE "expense_recurrences"
            ADD CONSTRAINT "fk_expense_recurrences_expense_type_id"
            FOREIGN KEY ("expense_type_id") REFERENCES "expense_types"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "expense_recurrences"
            ADD CONSTRAINT "fk_expense_recurrences_bank_account_id"
            FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "expense_recurrences"
            ADD CONSTRAINT "fk_expense_recurrences_credit_card_id"
            FOREIGN KEY ("credit_card_id") REFERENCES "credit_cards"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
        await queryRunner.query(
            'CREATE INDEX "idx_expense_recurrences_ends_on" ON "expense_recurrences" ("ends_on")',
        );
        await queryRunner.query(`
            CREATE TRIGGER "set_expense_recurrences_updated_at"
            BEFORE UPDATE ON "expense_recurrences"
            FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        `);

        await queryRunner.query('ALTER TABLE "expenses" ADD COLUMN "recurrence_id" uuid');
        await queryRunner.query(`
            ALTER TABLE "expenses"
            ADD CONSTRAINT "fk_expenses_recurrence_id"
            FOREIGN KEY ("recurrence_id") REFERENCES "expense_recurrences"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);

        // Backfill: uma série encerrada por `FIXED` já existente.
        await queryRunner.query(`
            ALTER TABLE "expenses" ADD COLUMN "legacy_recurrence_id" uuid
        `);
        await queryRunner.query(`
            UPDATE "expenses" SET "legacy_recurrence_id" = gen_random_uuid() WHERE "kind" = 'FIXED'
        `);
        await queryRunner.query(`
            INSERT INTO "expense_recurrences" (
                "id", "description", "expense_type_id", "amount_cents", "day_of_month",
                "bank_account_id", "credit_card_id", "notes", "starts_on", "ends_on"
            )
            SELECT "legacy_recurrence_id", "description", "expense_type_id", "amount_cents",
                   EXTRACT(DAY FROM "occurred_on")::int, "bank_account_id", "credit_card_id",
                   "notes", "occurred_on", "occurred_on"
            FROM "expenses" WHERE "kind" = 'FIXED'
        `);
        await queryRunner.query(`
            UPDATE "expenses" SET "recurrence_id" = "legacy_recurrence_id" WHERE "kind" = 'FIXED'
        `);
        await queryRunner.query('ALTER TABLE "expenses" DROP COLUMN "legacy_recurrence_id"');

        await queryRunner.query(`
            ALTER TABLE "expenses"
            ADD CONSTRAINT "ck_expenses_recurrence"
            CHECK ((recurrence_id IS NOT NULL) = (kind = 'FIXED'))
        `);
        await queryRunner.query(`
            ALTER TABLE "expenses"
            ADD CONSTRAINT "uq_expenses_recurrence_id_occurred_on" UNIQUE ("recurrence_id", "occurred_on")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'ALTER TABLE "expenses" DROP CONSTRAINT "uq_expenses_recurrence_id_occurred_on"',
        );
        await queryRunner.query('ALTER TABLE "expenses" DROP CONSTRAINT "ck_expenses_recurrence"');
        await queryRunner.query(
            'ALTER TABLE "expenses" DROP CONSTRAINT "fk_expenses_recurrence_id"',
        );
        await queryRunner.query('ALTER TABLE "expenses" DROP COLUMN "recurrence_id"');
        await queryRunner.query(
            'DROP TRIGGER IF EXISTS "set_expense_recurrences_updated_at" ON "expense_recurrences"',
        );
        await queryRunner.query('DROP TABLE "expense_recurrences"');
    }
}
