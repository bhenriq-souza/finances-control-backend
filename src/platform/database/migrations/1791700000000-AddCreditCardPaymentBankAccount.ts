import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Conta pagadora padrão do cartão (spec 0011, emenda da spec 0015): nullable, FK
 * `bank_accounts(id)` com `ON DELETE RESTRICT`, constraint nomeada.
 */
export class AddCreditCardPaymentBankAccount1791700000000 implements MigrationInterface {
    name = 'AddCreditCardPaymentBankAccount1791700000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "credit_cards" ADD "payment_bank_account_id" uuid');
        await queryRunner.query(`
            ALTER TABLE "credit_cards"
            ADD CONSTRAINT "fk_credit_cards_payment_bank_account_id"
            FOREIGN KEY ("payment_bank_account_id") REFERENCES "bank_accounts"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "credit_cards" DROP CONSTRAINT "fk_credit_cards_payment_bank_account_id"
        `);
        await queryRunner.query('ALTER TABLE "credit_cards" DROP COLUMN "payment_bank_account_id"');
    }
}
