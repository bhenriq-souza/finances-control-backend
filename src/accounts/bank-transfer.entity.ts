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
import { BankAccount } from './bank-account.entity';
import { BANK_TRANSFER_STATUSES, type BankTransferStatus } from './bank-transfer-status';

@Entity('bank_transfers')
@Check('ck_bank_transfers_amount', 'amount_cents > 0')
@Check('ck_bank_transfers_status', `status IN ('${BANK_TRANSFER_STATUSES.join("', '")}')`)
@Check('ck_bank_transfers_completed_on', "(status = 'COMPLETED') = (completed_on IS NOT NULL)")
@Check('ck_bank_transfers_accounts', 'from_bank_account_id <> to_bank_account_id')
@Index('idx_bank_transfers_from_bank_account_id', ['fromBankAccountId'])
@Index('idx_bank_transfers_to_bank_account_id', ['toBankAccountId'])
@Index('idx_bank_transfers_occurred_on', ['occurredOn'])
export class BankTransfer {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'uuid' })
    fromBankAccountId!: string;

    @ManyToOne(() => BankAccount, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({
        name: 'from_bank_account_id',
        foreignKeyConstraintName: 'fk_bank_transfers_from_bank_account_id',
    })
    fromBankAccount?: BankAccount;

    @Column({ type: 'uuid' })
    toBankAccountId!: string;

    @ManyToOne(() => BankAccount, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({
        name: 'to_bank_account_id',
        foreignKeyConstraintName: 'fk_bank_transfers_to_bank_account_id',
    })
    toBankAccount?: BankAccount;

    @Column({ type: 'numeric', precision: 14, scale: 2, transformer: moneyTransformer })
    amountCents!: number;

    /** `YYYY-MM-DD`: a data prevista, ou a data em que aconteceu. */
    @Column({ type: 'date' })
    occurredOn!: string;

    @Column({ type: 'text' })
    status!: BankTransferStatus;

    /** Não nulo se e só se `status = 'COMPLETED'` (INV-0018-05). */
    @Column({ type: 'date', nullable: true })
    completedOn!: string | null;

    @Column({ type: 'text' })
    description!: string;

    @Column({ type: 'text', nullable: true })
    notes!: string | null;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    createdAt!: Date;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    updatedAt!: Date;
}
