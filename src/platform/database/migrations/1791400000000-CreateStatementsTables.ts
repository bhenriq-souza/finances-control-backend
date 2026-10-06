import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tabelas da spec 0013: faturas fechadas, pagamentos de fatura e estornos.
 *
 * Escrita à mão, como as demais: default `gen_random_uuid()`, FKs nomeadas e
 * triggers de `updated_at` declarados (spec 0003). Não há coluna de total.
 */
export class CreateStatementsTables1791400000000 implements MigrationInterface {
    name = 'CreateStatementsTables1791400000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "credit_card_statements" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "credit_card_id" uuid NOT NULL,
                "starts_on" date NOT NULL,
                "closes_on" date NOT NULL,
                "due_on" date NOT NULL,
                "status" text NOT NULL,
                "previous_balance_cents" numeric(14,2) NOT NULL,
                "minimum_payment_cents" numeric(14,2),
                "closed_at" timestamptz NOT NULL,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "pk_credit_card_statements" PRIMARY KEY ("id"),
                CONSTRAINT "uq_credit_card_statements_credit_card_id_closes_on" UNIQUE ("credit_card_id", "closes_on"),
                CONSTRAINT "uq_credit_card_statements_credit_card_id_starts_on" UNIQUE ("credit_card_id", "starts_on"),
                CONSTRAINT "ck_credit_card_statements_status" CHECK (status IN ('CLOSED', 'PAID', 'ROLLED_OVER')),
                CONSTRAINT "ck_credit_card_statements_minimum_payment" CHECK (minimum_payment_cents >= 0),
                CONSTRAINT "ck_credit_card_statements_dates" CHECK (starts_on <= closes_on AND closes_on < due_on)
            )
        `);
        await queryRunner.query(`
            ALTER TABLE "credit_card_statements"
            ADD CONSTRAINT "fk_credit_card_statements_credit_card_id"
            FOREIGN KEY ("credit_card_id") REFERENCES "credit_cards"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            CREATE TABLE "credit_card_statement_payments" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "credit_card_id" uuid NOT NULL,
                "statement_id" uuid,
                "bank_account_id" uuid NOT NULL,
                "amount_cents" numeric(14,2) NOT NULL,
                "paid_on" date NOT NULL,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "pk_credit_card_statement_payments" PRIMARY KEY ("id"),
                CONSTRAINT "ck_credit_card_statement_payments_amount" CHECK (amount_cents > 0)
            )
        `);
        await queryRunner.query(`
            ALTER TABLE "credit_card_statement_payments"
            ADD CONSTRAINT "fk_credit_card_statement_payments_credit_card_id"
            FOREIGN KEY ("credit_card_id") REFERENCES "credit_cards"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "credit_card_statement_payments"
            ADD CONSTRAINT "fk_credit_card_statement_payments_statement_id"
            FOREIGN KEY ("statement_id") REFERENCES "credit_card_statements"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "credit_card_statement_payments"
            ADD CONSTRAINT "fk_credit_card_statement_payments_bank_account_id"
            FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            CREATE INDEX "idx_credit_card_statement_payments_statement_id"
            ON "credit_card_statement_payments" ("statement_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "idx_credit_card_statement_payments_credit_card_id"
            ON "credit_card_statement_payments" ("credit_card_id")
        `);

        await queryRunner.query(`
            CREATE TABLE "credit_card_refunds" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "credit_card_id" uuid NOT NULL,
                "expense_id" uuid,
                "description" text NOT NULL,
                "amount_cents" numeric(14,2) NOT NULL,
                "occurred_on" date NOT NULL,
                "posted_on" date NOT NULL,
                "notes" text,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "pk_credit_card_refunds" PRIMARY KEY ("id"),
                CONSTRAINT "ck_credit_card_refunds_amount" CHECK (amount_cents > 0),
                CONSTRAINT "ck_credit_card_refunds_posted_on" CHECK (posted_on >= occurred_on)
            )
        `);
        await queryRunner.query(`
            ALTER TABLE "credit_card_refunds"
            ADD CONSTRAINT "fk_credit_card_refunds_credit_card_id"
            FOREIGN KEY ("credit_card_id") REFERENCES "credit_cards"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "credit_card_refunds"
            ADD CONSTRAINT "fk_credit_card_refunds_expense_id"
            FOREIGN KEY ("expense_id") REFERENCES "expenses"("id")
            ON DELETE SET NULL ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            CREATE INDEX "idx_credit_card_refunds_credit_card_id_posted_on"
            ON "credit_card_refunds" ("credit_card_id", "posted_on")
        `);

        for (const table of [
            'credit_card_statements',
            'credit_card_statement_payments',
            'credit_card_refunds',
        ]) {
            await queryRunner.query(`
                CREATE TRIGGER "set_${table}_updated_at"
                BEFORE UPDATE ON "${table}"
                FOR EACH ROW EXECUTE FUNCTION set_updated_at()
            `);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of [
            'credit_card_refunds',
            'credit_card_statement_payments',
            'credit_card_statements',
        ]) {
            await queryRunner.query(`
                DROP TRIGGER IF EXISTS "set_${table}_updated_at" ON "${table}"
            `);
            await queryRunner.query(`DROP TABLE "${table}"`);
        }
    }
}
