import {
    Check,
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from 'typeorm';

import { moneyTransformer } from '../platform';
import type { ExpenseKind } from './expense-kind';
import type { ExpenseStatus } from './expense-status';
import { ExpenseType } from './expense-type.entity';

@Entity('expenses')
@Unique('uq_expenses_installment_group_id_installment_number', [
    'installmentGroupId',
    'installmentNumber',
])
@Unique('uq_expenses_recurrence_id_occurred_on', ['recurrenceId', 'occurredOn'])
@Check('ck_expenses_kind', "kind IN ('FIXED', 'VARIABLE', 'INSTALLMENT')")
@Check('ck_expenses_status', "status IN ('OPEN', 'FORECAST', 'PAID', 'OVERDUE', 'VERIFYING')")
@Check('ck_expenses_amount', 'amount_cents > 0')
@Check('ck_expenses_paid_on', "(paid_on IS NOT NULL) = (status = 'PAID')")
@Check('ck_expenses_owner', '(bank_account_id IS NULL) <> (credit_card_id IS NULL)')
@Check(
    'ck_expenses_installment',
    "(kind = 'INSTALLMENT') = (installment_group_id IS NOT NULL AND installment_number IS NOT NULL AND installment_total IS NOT NULL) AND (installment_group_id IS NOT NULL OR (installment_number IS NULL AND installment_total IS NULL)) AND (kind <> 'INSTALLMENT' OR (installment_total >= 2 AND installment_number >= 1 AND installment_number <= installment_total))",
)
@Check('ck_expenses_recurrence', "(recurrence_id IS NOT NULL) = (kind = 'FIXED')")
@Check(
    'ck_expenses_posted_on',
    '(posted_on IS NOT NULL) = (credit_card_id IS NOT NULL) AND (posted_on IS NULL OR posted_on >= occurred_on)',
)
@Index('idx_expenses_occurred_on', ['occurredOn'])
@Index('idx_expenses_bank_account_id', ['bankAccountId'])
@Index('idx_expenses_credit_card_id', ['creditCardId'])
@Index('idx_expenses_status', ['status'])
@Index('idx_expenses_credit_card_id_posted_on', ['creditCardId', 'postedOn'])
export class Expense {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'text' })
    description!: string;

    @Column({ type: 'uuid' })
    expenseTypeId!: string;

    @ManyToOne(() => ExpenseType, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({
        name: 'expense_type_id',
        foreignKeyConstraintName: 'fk_expenses_expense_type_id',
    })
    expenseType?: ExpenseType;

    @Column({ type: 'text' })
    kind!: ExpenseKind;

    @Column({ type: 'text' })
    status!: ExpenseStatus;

    @Column({ type: 'numeric', precision: 14, scale: 2, transformer: moneyTransformer })
    amountCents!: number;

    /** Conta: vencimento. Cartão: data da compra. Formato `YYYY-MM-DD`. */
    @Column({ type: 'date' })
    occurredOn!: string;

    @Column({ type: 'date', nullable: true })
    paidOn!: string | null;

    /** FK `fk_expenses_bank_account_id` só no banco: o módulo não toca `accounts` (ADR-0003). */
    @Column({ type: 'uuid', nullable: true })
    bankAccountId!: string | null;

    @Column({ type: 'uuid', nullable: true })
    creditCardId!: string | null;

    /** Data de lançamento na fatura; só despesa de cartão (INV-0012-14). */
    @Column({ type: 'date', nullable: true })
    postedOn!: string | null;

    @Column({ type: 'uuid', nullable: true })
    installmentGroupId!: string | null;

    @Column({ type: 'int', nullable: true })
    installmentNumber!: number | null;

    @Column({ type: 'int', nullable: true })
    installmentTotal!: number | null;

    /** Série da despesa `FIXED` (spec 0017); nulo nas demais. */
    @Column({ type: 'uuid', nullable: true })
    recurrenceId!: string | null;

    @Column({ type: 'text', nullable: true })
    notes!: string | null;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    createdAt!: Date;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    updatedAt!: Date;
}
