import {
    Check,
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';

import { moneyTransformer } from '../platform';
import { ExpenseType } from './expense-type.entity';

/** A série de uma despesa `FIXED` (spec 0017): o modelo dos meses seguintes. */
@Entity('expense_recurrences')
@Check('ck_expense_recurrences_amount', 'amount_cents > 0')
@Check('ck_expense_recurrences_day_of_month', 'day_of_month BETWEEN 1 AND 31')
@Check('ck_expense_recurrences_owner', '(bank_account_id IS NULL) <> (credit_card_id IS NULL)')
@Check('ck_expense_recurrences_ends_on', 'ends_on IS NULL OR ends_on >= starts_on')
@Index('idx_expense_recurrences_ends_on', ['endsOn'])
export class ExpenseRecurrence {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'text' })
    description!: string;

    @Column({ type: 'uuid' })
    expenseTypeId!: string;

    @ManyToOne(() => ExpenseType, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({
        name: 'expense_type_id',
        foreignKeyConstraintName: 'fk_expense_recurrences_expense_type_id',
    })
    expenseType?: ExpenseType;

    @Column({ type: 'numeric', precision: 14, scale: 2, transformer: moneyTransformer })
    amountCents!: number;

    @Column({ type: 'int' })
    dayOfMonth!: number;

    /** FKs só no banco: o módulo não toca `accounts` (ADR-0003). */
    @Column({ type: 'uuid', nullable: true })
    bankAccountId!: string | null;

    @Column({ type: 'uuid', nullable: true })
    creditCardId!: string | null;

    @Column({ type: 'text', nullable: true })
    notes!: string | null;

    @Column({ type: 'date' })
    startsOn!: string;

    /** Última data admitida; nula é série sem fim. */
    @Column({ type: 'date', nullable: true })
    endsOn!: string | null;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    createdAt!: Date;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    updatedAt!: Date;
}
