import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tabelas da spec 0014, com os oito tipos pré-definidos de receita.
 *
 * Escrita à mão sobre o que `migration:generate` produziria, nos pontos que o
 * gerador não infere: a PK usa `gen_random_uuid()`, o índice único de
 * `earning_types.name` é funcional sobre `lower(name)` e os triggers de
 * `updated_at` são declarados (spec 0003). Os tipos são linhas comuns —
 * arquiváveis e renomeáveis, sem coluna que as distinga.
 */
export class CreateEarningsTables1791306866742 implements MigrationInterface {
    name = 'CreateEarningsTables1791306866742';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "earning_types" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "name" text NOT NULL,
                "archived_at" timestamptz,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "pk_earning_types" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_earning_types_name" ON "earning_types" (lower("name"))
        `);

        await queryRunner.query(`
            CREATE TABLE "earnings" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "description" text NOT NULL,
                "earning_type_id" uuid NOT NULL,
                "kind" text NOT NULL,
                "status" text NOT NULL,
                "amount_cents" numeric(14,2) NOT NULL,
                "occurred_on" date NOT NULL,
                "received_on" date,
                "bank_account_id" uuid NOT NULL,
                "installment_group_id" uuid,
                "installment_number" integer,
                "installment_total" integer,
                "notes" text,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "pk_earnings" PRIMARY KEY ("id"),
                CONSTRAINT "uq_earnings_installment_group_id_installment_number" UNIQUE ("installment_group_id", "installment_number"),
                CONSTRAINT "ck_earnings_kind" CHECK (kind IN ('FIXED', 'VARIABLE', 'INSTALLMENT')),
                CONSTRAINT "ck_earnings_status" CHECK (status IN ('OPEN', 'FORECAST', 'RECEIVED', 'OVERDUE', 'VERIFYING')),
                CONSTRAINT "ck_earnings_amount" CHECK (amount_cents > 0),
                CONSTRAINT "ck_earnings_received_on" CHECK ((received_on IS NOT NULL) = (status = 'RECEIVED')),
                CONSTRAINT "ck_earnings_installment" CHECK (
                    (kind = 'INSTALLMENT'
                        AND installment_group_id IS NOT NULL
                        AND installment_number IS NOT NULL
                        AND installment_total IS NOT NULL
                        AND installment_total >= 2
                        AND installment_number >= 1
                        AND installment_number <= installment_total)
                    OR (kind <> 'INSTALLMENT'
                        AND installment_group_id IS NULL
                        AND installment_number IS NULL
                        AND installment_total IS NULL)
                )
            )
        `);

        await queryRunner.query(`
            ALTER TABLE "earnings"
            ADD CONSTRAINT "fk_earnings_earning_type_id"
            FOREIGN KEY ("earning_type_id") REFERENCES "earning_types"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "earnings"
            ADD CONSTRAINT "fk_earnings_bank_account_id"
            FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);

        await queryRunner.query(
            'CREATE INDEX "idx_earnings_occurred_on" ON "earnings" ("occurred_on")',
        );
        await queryRunner.query(
            'CREATE INDEX "idx_earnings_bank_account_id" ON "earnings" ("bank_account_id")',
        );
        await queryRunner.query('CREATE INDEX "idx_earnings_status" ON "earnings" ("status")');

        for (const table of ['earning_types', 'earnings']) {
            await queryRunner.query(`
                CREATE TRIGGER "set_${table}_updated_at"
                BEFORE UPDATE ON "${table}"
                FOR EACH ROW EXECUTE FUNCTION set_updated_at()
            `);
        }

        await queryRunner.query(`
            INSERT INTO "earning_types" ("name") VALUES
                ('Salário'),
                ('Férias, 13º e verbas rescisórias'),
                ('Rendimento de investimento'),
                ('Restituição de imposto'),
                ('Reembolso'),
                ('Devolução de empréstimo'),
                ('Rateio de despesa'),
                ('Outros')
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of ['earnings', 'earning_types']) {
            await queryRunner.query(`
                DROP TRIGGER IF EXISTS "set_${table}_updated_at" ON "${table}"
            `);
        }

        await queryRunner.query('DROP TABLE "earnings"');
        await queryRunner.query('DROP TABLE "earning_types"');
    }
}
