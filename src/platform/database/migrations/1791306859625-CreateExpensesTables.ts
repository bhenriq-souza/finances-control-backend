import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tabelas da spec 0012 e os dez tipos de despesa pré-definidos (F003).
 *
 * Escrita à mão, como a das contas: o default da PK é `gen_random_uuid()`, o
 * índice único de `expense_types` é funcional (`lower(name)`) e os triggers de
 * `updated_at` são declarados (spec 0003). Os tipos entram como linhas comuns,
 * arquiváveis e renomeáveis.
 */
export class CreateExpensesTables1791306859625 implements MigrationInterface {
    name = 'CreateExpensesTables1791306859625';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "expense_types" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "name" text NOT NULL,
                "archived_at" timestamptz,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "pk_expense_types" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_expense_types_name" ON "expense_types" (lower("name"))
        `);

        await queryRunner.query(`
            INSERT INTO "expense_types" ("name") VALUES
                ('Moradia'),
                ('Alimentação'),
                ('Transporte'),
                ('Saúde'),
                ('Educação'),
                ('Lazer'),
                ('Vestuário'),
                ('Assinaturas'),
                ('Impostos e taxas'),
                ('Outros')
        `);

        await queryRunner.query(`
            CREATE TABLE "expenses" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "description" text NOT NULL,
                "expense_type_id" uuid NOT NULL,
                "kind" text NOT NULL,
                "status" text NOT NULL,
                "amount_cents" numeric(14,2) NOT NULL,
                "occurred_on" date NOT NULL,
                "paid_on" date,
                "bank_account_id" uuid,
                "credit_card_id" uuid,
                "posted_on" date,
                "installment_group_id" uuid,
                "installment_number" integer,
                "installment_total" integer,
                "notes" text,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "pk_expenses" PRIMARY KEY ("id"),
                CONSTRAINT "uq_expenses_installment_group_id_installment_number" UNIQUE ("installment_group_id", "installment_number"),
                CONSTRAINT "ck_expenses_kind" CHECK (kind IN ('FIXED', 'VARIABLE', 'INSTALLMENT')),
                CONSTRAINT "ck_expenses_status" CHECK (status IN ('OPEN', 'FORECAST', 'PAID', 'OVERDUE', 'VERIFYING')),
                CONSTRAINT "ck_expenses_amount" CHECK (amount_cents > 0),
                CONSTRAINT "ck_expenses_paid_on" CHECK ((paid_on IS NOT NULL) = (status = 'PAID')),
                CONSTRAINT "ck_expenses_owner" CHECK ((bank_account_id IS NULL) <> (credit_card_id IS NULL)),
                CONSTRAINT "ck_expenses_installment" CHECK (
                    (kind = 'INSTALLMENT') = (installment_group_id IS NOT NULL AND installment_number IS NOT NULL AND installment_total IS NOT NULL)
                    AND (installment_group_id IS NOT NULL OR (installment_number IS NULL AND installment_total IS NULL))
                    AND (kind <> 'INSTALLMENT' OR (installment_total >= 2 AND installment_number >= 1 AND installment_number <= installment_total))
                ),
                CONSTRAINT "ck_expenses_posted_on" CHECK (
                    (posted_on IS NOT NULL) = (credit_card_id IS NOT NULL)
                    AND (posted_on IS NULL OR posted_on >= occurred_on)
                )
            )
        `);

        await queryRunner.query(`
            ALTER TABLE "expenses"
            ADD CONSTRAINT "fk_expenses_expense_type_id"
            FOREIGN KEY ("expense_type_id") REFERENCES "expense_types"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "expenses"
            ADD CONSTRAINT "fk_expenses_bank_account_id"
            FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "expenses"
            ADD CONSTRAINT "fk_expenses_credit_card_id"
            FOREIGN KEY ("credit_card_id") REFERENCES "credit_cards"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);

        await queryRunner.query(
            'CREATE INDEX "idx_expenses_occurred_on" ON "expenses" ("occurred_on")',
        );
        await queryRunner.query(
            'CREATE INDEX "idx_expenses_bank_account_id" ON "expenses" ("bank_account_id")',
        );
        await queryRunner.query(
            'CREATE INDEX "idx_expenses_credit_card_id" ON "expenses" ("credit_card_id")',
        );
        await queryRunner.query('CREATE INDEX "idx_expenses_status" ON "expenses" ("status")');
        await queryRunner.query(`
            CREATE INDEX "idx_expenses_credit_card_id_posted_on"
            ON "expenses" ("credit_card_id", "posted_on")
        `);

        for (const table of ['expense_types', 'expenses']) {
            await queryRunner.query(`
                CREATE TRIGGER "set_${table}_updated_at"
                BEFORE UPDATE ON "${table}"
                FOR EACH ROW EXECUTE FUNCTION set_updated_at()
            `);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of ['expenses', 'expense_types']) {
            await queryRunner.query(`
                DROP TRIGGER IF EXISTS "set_${table}_updated_at" ON "${table}"
            `);
        }

        await queryRunner.query('DROP TABLE "expenses"');
        await queryRunner.query('DROP INDEX "uq_expense_types_name"');
        await queryRunner.query('DROP TABLE "expense_types"');
    }
}
