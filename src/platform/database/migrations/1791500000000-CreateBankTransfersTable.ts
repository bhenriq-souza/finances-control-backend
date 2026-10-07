import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tabela da spec 0018. Escrita à mão no padrão das anteriores: PK com
 * `gen_random_uuid()`, constraints nomeadas, trigger de `updated_at` (spec 0003).
 */
export class CreateBankTransfersTable1791500000000 implements MigrationInterface {
    name = 'CreateBankTransfersTable1791500000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "bank_transfers" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "from_bank_account_id" uuid NOT NULL,
                "to_bank_account_id" uuid NOT NULL,
                "amount_cents" numeric(14,2) NOT NULL,
                "occurred_on" date NOT NULL,
                "status" text NOT NULL,
                "completed_on" date,
                "description" text NOT NULL,
                "notes" text,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "pk_bank_transfers" PRIMARY KEY ("id"),
                CONSTRAINT "ck_bank_transfers_amount" CHECK (amount_cents > 0),
                CONSTRAINT "ck_bank_transfers_status" CHECK (status IN ('SCHEDULED', 'COMPLETED')),
                CONSTRAINT "ck_bank_transfers_completed_on" CHECK ((status = 'COMPLETED') = (completed_on IS NOT NULL)),
                CONSTRAINT "ck_bank_transfers_accounts" CHECK (from_bank_account_id <> to_bank_account_id)
            )
        `);

        await queryRunner.query(`
            ALTER TABLE "bank_transfers"
            ADD CONSTRAINT "fk_bank_transfers_from_bank_account_id"
            FOREIGN KEY ("from_bank_account_id") REFERENCES "bank_accounts"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "bank_transfers"
            ADD CONSTRAINT "fk_bank_transfers_to_bank_account_id"
            FOREIGN KEY ("to_bank_account_id") REFERENCES "bank_accounts"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            CREATE INDEX "idx_bank_transfers_from_bank_account_id"
            ON "bank_transfers" ("from_bank_account_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "idx_bank_transfers_to_bank_account_id"
            ON "bank_transfers" ("to_bank_account_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "idx_bank_transfers_occurred_on"
            ON "bank_transfers" ("occurred_on")
        `);

        await queryRunner.query(`
            CREATE TRIGGER "set_bank_transfers_updated_at"
            BEFORE UPDATE ON "bank_transfers"
            FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP TRIGGER IF EXISTS "set_bank_transfers_updated_at" ON "bank_transfers"
        `);
        await queryRunner.query('DROP TABLE "bank_transfers"');
    }
}
