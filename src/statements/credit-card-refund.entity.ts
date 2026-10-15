import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { moneyTransformer } from '../platform';

/**
 * Estorno de cartão (spec 0013). `expenseId` nulo quando a despesa de origem é
 * excluída (`on delete set null`). As FKs vivem só na migration.
 */
@Entity('credit_card_refunds')
@Index('idx_credit_card_refunds_workspace_id', ['workspaceId'])
@Check('ck_credit_card_refunds_amount', 'amount_cents > 0')
@Check('ck_credit_card_refunds_posted_on', 'posted_on >= occurred_on')
@Index('idx_credit_card_refunds_credit_card_id_posted_on', ['creditCardId', 'postedOn'])
export class CreditCardRefund {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    /**
     * Espaço do registro (spec 0021). Gravado na criação, a partir do contexto da
     * requisição ou da linha de origem num job, e nunca muda. As referências a
     * outras tabelas do espaço são FKs compostas com ele (INV-0021-04).
     */
    @Column({ type: 'uuid' })
    workspaceId!: string;

    @Column({ type: 'uuid' })
    creditCardId!: string;

    @Column({ type: 'uuid', nullable: true })
    expenseId!: string | null;

    @Column({ type: 'text' })
    description!: string;

    @Column({ type: 'numeric', precision: 14, scale: 2, transformer: moneyTransformer })
    amountCents!: number;

    @Column({ type: 'date' })
    occurredOn!: string;

    /** Data de lançamento na fatura (INV-0013-01). */
    @Column({ type: 'date' })
    postedOn!: string;

    @Column({ type: 'text', nullable: true })
    notes!: string | null;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    createdAt!: Date;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    updatedAt!: Date;
}
