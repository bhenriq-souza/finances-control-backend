import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { moneyTransformer } from '../platform';

/**
 * Pagamento de fatura (spec 0013). `statementId` nulo é o pagamento antecipado.
 * As FKs (cartão, fatura, conta) vivem só na migration.
 */
@Entity('credit_card_statement_payments')
@Check('ck_credit_card_statement_payments_amount', 'amount_cents > 0')
@Index('idx_credit_card_statement_payments_statement_id', ['statementId'])
@Index('idx_credit_card_statement_payments_credit_card_id', ['creditCardId'])
export class CreditCardStatementPayment {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'uuid' })
    creditCardId!: string;

    @Column({ type: 'uuid', nullable: true })
    statementId!: string | null;

    @Column({ type: 'uuid' })
    bankAccountId!: string;

    @Column({ type: 'numeric', precision: 14, scale: 2, transformer: moneyTransformer })
    amountCents!: number;

    @Column({ type: 'date' })
    paidOn!: string;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    createdAt!: Date;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    updatedAt!: Date;
}
