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
import { EARNING_KINDS, type EarningKind } from './earning-kind';
import { EARNING_STATUSES, type EarningStatus } from './earning-status';
import { EarningType } from './earning-type.entity';

@Entity('earnings')
@Unique('uq_earnings_installment_group_id_installment_number', [
    'installmentGroupId',
    'installmentNumber',
])
@Unique('uq_earnings_recurrence_id_occurred_on', ['recurrenceId', 'occurredOn'])
@Index('idx_earnings_occurred_on', ['occurredOn'])
@Index('idx_earnings_bank_account_id', ['bankAccountId'])
@Index('idx_earnings_status', ['status'])
@Check('ck_earnings_kind', `kind IN ('${EARNING_KINDS.join("', '")}')`)
@Check('ck_earnings_status', `status IN ('${EARNING_STATUSES.join("', '")}')`)
@Check('ck_earnings_amount', 'amount_cents > 0')
@Check('ck_earnings_received_on', "(received_on IS NOT NULL) = (status = 'RECEIVED')")
@Check('ck_earnings_recurrence', "(recurrence_id IS NOT NULL) = (kind = 'FIXED')")
@Check(
    'ck_earnings_installment',
    `(kind = 'INSTALLMENT'
        AND installment_group_id IS NOT NULL
        AND installment_number IS NOT NULL
        AND installment_total IS NOT NULL
        AND installment_total >= 2
        AND installment_number >= 1
        AND installment_number <= installment_total)
     OR (kind <> 'INSTALLMENT'
        AND installment_group_id IS NULL
        AND installment_number IS NULL
        AND installment_total IS NULL)`,
)
export class Earning {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'text' })
    description!: string;

    @Column({ type: 'uuid' })
    earningTypeId!: string;

    @ManyToOne(() => EarningType, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({
        name: 'earning_type_id',
        foreignKeyConstraintName: 'fk_earnings_earning_type_id',
    })
    earningType?: EarningType;

    @Column({ type: 'text' })
    kind!: EarningKind;

    @Column({ type: 'text' })
    status!: EarningStatus;

    @Column({ type: 'numeric', precision: 14, scale: 2, transformer: moneyTransformer })
    amountCents!: number;

    /** Data **esperada** do recebimento; a varredura de vencidas usa esta data. */
    @Column({ type: 'date' })
    occurredOn!: string;

    /** Data em que entrou de fato; não nula se e só se `status = 'RECEIVED'` (INV-0014-04). */
    @Column({ type: 'date', nullable: true })
    receivedOn!: string | null;

    /**
     * Toda receita pertence a exatamente uma conta (INV-0014-02). A FK
     * `fk_earnings_bank_account_id` é constraint de banco, declarada na migration:
     * o módulo não importa `accounts` para modelá-la (ADR-0003, regra 2).
     */
    @Column({ type: 'uuid' })
    bankAccountId!: string;

    @Column({ type: 'uuid', nullable: true })
    installmentGroupId!: string | null;

    @Column({ type: 'int', nullable: true })
    installmentNumber!: number | null;

    @Column({ type: 'int', nullable: true })
    installmentTotal!: number | null;

    /** Série da receita `FIXED` (spec 0017); nulo nas demais. */
    @Column({ type: 'uuid', nullable: true })
    recurrenceId!: string | null;

    @Column({ type: 'text', nullable: true })
    notes!: string | null;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    createdAt!: Date;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    updatedAt!: Date;
}
