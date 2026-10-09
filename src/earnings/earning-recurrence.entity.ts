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
import { EarningType } from './earning-type.entity';

/** A série de uma receita `FIXED` (spec 0017): o modelo dos meses seguintes. */
@Entity('earning_recurrences')
@Check('ck_earning_recurrences_amount', 'amount_cents > 0')
@Check('ck_earning_recurrences_day_of_month', 'day_of_month BETWEEN 1 AND 31')
@Check('ck_earning_recurrences_ends_on', 'ends_on IS NULL OR ends_on >= starts_on')
@Index('idx_earning_recurrences_ends_on', ['endsOn'])
export class EarningRecurrence {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'text' })
    description!: string;

    @Column({ type: 'uuid' })
    earningTypeId!: string;

    @ManyToOne(() => EarningType, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({
        name: 'earning_type_id',
        foreignKeyConstraintName: 'fk_earning_recurrences_earning_type_id',
    })
    earningType?: EarningType;

    @Column({ type: 'numeric', precision: 14, scale: 2, transformer: moneyTransformer })
    amountCents!: number;

    @Column({ type: 'int' })
    dayOfMonth!: number;

    /** FK só no banco: o módulo não toca `accounts` (ADR-0003). */
    @Column({ type: 'uuid' })
    bankAccountId!: string;

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
