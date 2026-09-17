import {
    Check,
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from 'typeorm';

import { moneyTransformer } from '../platform';
import { Bank } from './bank.entity';

@Entity('credit_cards')
@Unique('uq_credit_cards_bank_id_name', ['bankId', 'name'])
@Check('ck_credit_cards_credit_limit', 'credit_limit_cents > 0')
@Check('ck_credit_cards_closing_day', 'closing_day BETWEEN 1 AND 31')
@Check('ck_credit_cards_due_day', 'due_day BETWEEN 1 AND 31')
export class CreditCard {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'uuid' })
    bankId!: string;

    @ManyToOne(() => Bank, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'bank_id', foreignKeyConstraintName: 'fk_credit_cards_bank_id' })
    bank?: Bank;

    @Column({ type: 'text' })
    name!: string;

    @Column({ type: 'numeric', precision: 14, scale: 2, transformer: moneyTransformer })
    creditLimitCents!: number;

    /** Só lançamento escreve aqui, na mesma transação (INV-0011-04). */
    @Column({ type: 'numeric', precision: 14, scale: 2, transformer: moneyTransformer })
    availableLimitCents!: number;

    /**
     * Dias do mês, sem mês (F002). Alteráveis a qualquer momento — e a alteração
     * nunca recalcula ciclo já fechado (INV-0011-07).
     */
    @Column({ type: 'int' })
    closingDay!: number;

    @Column({ type: 'int' })
    dueDay!: number;

    @Column({ type: 'timestamptz', nullable: true })
    archivedAt!: Date | null;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    createdAt!: Date;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    updatedAt!: Date;
}
