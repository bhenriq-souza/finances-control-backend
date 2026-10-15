import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marca de incluída na fatura do banco (spec 0020): nullable, só em despesa de cartão que não
 * esteja `FORECAST` (INV-0020-01), por constraint nomeada.
 */
export class AddExpenseReconciledAt1792100000000 implements MigrationInterface {
    name = 'AddExpenseReconciledAt1792100000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'ALTER TABLE "expenses" ADD "reconciled_at" TIMESTAMP WITH TIME ZONE',
        );
        await queryRunner.query(`
            ALTER TABLE "expenses" ADD CONSTRAINT "ck_expenses_reconciled_at"
            CHECK (reconciled_at IS NULL OR (credit_card_id IS NOT NULL AND status <> 'FORECAST'))
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'ALTER TABLE "expenses" DROP CONSTRAINT "ck_expenses_reconciled_at"',
        );
        await queryRunner.query('ALTER TABLE "expenses" DROP COLUMN "reconciled_at"');
    }
}
