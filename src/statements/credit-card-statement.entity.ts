import { Check, Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

import { moneyTransformer } from '../platform';
import type { StatementStatus } from './statement-status';

/**
 * Fatura **fechada** (spec 0013). A aberta é projetada, não persistida.
 * FK `fk_credit_card_statements_credit_card_id` só na migration: o módulo não toca
 * `accounts` (ADR-0003). Não há coluna de total nem de valor pago.
 */
@Entity('credit_card_statements')
@Index('idx_credit_card_statements_workspace_id', ['workspaceId'])
@Unique('uq_credit_card_statements_credit_card_id_closes_on', ['creditCardId', 'closesOn'])
@Unique('uq_credit_card_statements_credit_card_id_starts_on', ['creditCardId', 'startsOn'])
@Check('ck_credit_card_statements_status', "status IN ('CLOSED', 'PAID', 'ROLLED_OVER')")
@Check('ck_credit_card_statements_minimum_payment', 'minimum_payment_cents >= 0')
@Check('ck_credit_card_statements_dates', 'starts_on <= closes_on AND closes_on < due_on')
export class CreditCardStatement {
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

    /** Formato `YYYY-MM-DD`; congelada no fechamento (INV-0013-04). */
    @Column({ type: 'date' })
    startsOn!: string;

    @Column({ type: 'date' })
    closesOn!: string;

    @Column({ type: 'date' })
    dueOn!: string;

    @Column({ type: 'text' })
    status!: StatementStatus;

    /** Restante da fatura anterior no registro; escrito só pelo sistema (INV-0013-09). */
    @Column({ type: 'numeric', precision: 14, scale: 2, transformer: moneyTransformer })
    previousBalanceCents!: number;

    @Column({
        type: 'numeric',
        precision: 14,
        scale: 2,
        nullable: true,
        transformer: moneyTransformer,
    })
    minimumPaymentCents!: number | null;

    @Column({ type: 'timestamptz' })
    closedAt!: Date;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    createdAt!: Date;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    updatedAt!: Date;
}
