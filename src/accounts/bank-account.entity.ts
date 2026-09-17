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
import { BANK_ACCOUNT_TYPES, type BankAccountType } from './bank-account-type';
import { Bank } from './bank.entity';

@Entity('bank_accounts')
@Unique('uq_bank_accounts_bank_id_account_number', ['bankId', 'accountNumber'])
@Check('ck_bank_accounts_type', `type IN ('${BANK_ACCOUNT_TYPES.join("', '")}')`)
@Check('ck_bank_accounts_overdraft_limit', 'overdraft_limit_cents >= 0')
export class BankAccount {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'uuid' })
    bankId!: string;

    @ManyToOne(() => Bank, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'bank_id', foreignKeyConstraintName: 'fk_bank_accounts_bank_id' })
    bank?: Bank;

    @Column({ type: 'text' })
    type!: BankAccountType;

    @Column({ type: 'text' })
    accountNumber!: string;

    @Column({ type: 'text' })
    description!: string;

    /** Imutável depois da criação: é a origem de um saldo derivado (INV-0011-05). */
    @Column({ type: 'numeric', precision: 14, scale: 2, transformer: moneyTransformer })
    openingBalanceCents!: number;

    /** Só lançamento escreve aqui, na mesma transação (INV-0011-04, ADR-0003 regra 4). */
    @Column({ type: 'numeric', precision: 14, scale: 2, transformer: moneyTransformer })
    currentBalanceCents!: number;

    /** Cheque especial. O saldo pode ficar negativo; o que fazer é regra de despesa. */
    @Column({
        type: 'numeric',
        precision: 14,
        scale: 2,
        default: 0,
        transformer: moneyTransformer,
    })
    overdraftLimitCents!: number;

    @Column({ type: 'timestamptz', nullable: true })
    archivedAt!: Date | null;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    createdAt!: Date;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    updatedAt!: Date;
}
