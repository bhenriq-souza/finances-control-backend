import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import type { DataSource, Repository } from 'typeorm';

import { DatabaseConnectionSymbol } from '../platform';
import { BankAccount } from './bank-account.entity';
import type { BankAccountType } from './bank-account-type';
import { Bank } from './bank.entity';
import { asConflict } from './unique-violation';

const CONFLICTS = {
    uq_bank_accounts_bank_id_account_number: {
        code: 'BANK_ACCOUNT_ALREADY_EXISTS',
        message: 'This account number is already registered for this bank',
    },
};

export type BankAccountWithBank = BankAccount & { bank: Bank };

export type CreateBankAccount = {
    bankId: string;
    type: BankAccountType;
    accountNumber: string;
    description: string;
    openingBalanceCents: number;
    overdraftLimitCents?: number;
};

export type UpdateBankAccount = Partial<
    Pick<BankAccount, 'type' | 'accountNumber' | 'description' | 'overdraftLimitCents'>
>;

@injectable()
export class BankAccountService {
    constructor(@inject(DatabaseConnectionSymbol) private readonly dataSource: DataSource) {}

    private get accounts(): Repository<BankAccount> {
        return this.dataSource.getRepository(BankAccount);
    }

    list(): Promise<BankAccountWithBank[]> {
        return this.accounts.find({
            relations: { bank: true },
            order: { description: 'ASC' },
        }) as Promise<BankAccountWithBank[]>;
    }

    async findById(id: string): Promise<BankAccountWithBank> {
        const account = await this.accounts.findOne({ where: { id }, relations: { bank: true } });

        if (!account) throw accountNotFound();

        return account as BankAccountWithBank;
    }

    async create(data: CreateBankAccount): Promise<BankAccountWithBank> {
        await this.assertBankIsUsable(data.bankId);

        const created = await asConflict(
            this.accounts.save(
                this.accounts.create({
                    ...data,
                    overdraftLimitCents: data.overdraftLimitCents ?? 0,
                    // Nasce igual ao de abertura, e daqui em diante só lançamento
                    // o move (INV-0011-04).
                    currentBalanceCents: data.openingBalanceCents,
                    archivedAt: null,
                }),
            ),
            CONFLICTS,
        );

        return this.findById(created.id);
    }

    async update(id: string, changes: UpdateBankAccount): Promise<BankAccountWithBank> {
        await this.findById(id);

        if (Object.keys(changes).length > 0) {
            await asConflict(this.accounts.update({ id }, changes), CONFLICTS);
        }

        return this.findById(id);
    }

    /**
     * Um banco arquivado não recebe conta nova: arquivar é dizer que ele saiu de
     * uso, e continuar pendurando registros nele desfaz o gesto (ERR-0011-07).
     */
    private async assertBankIsUsable(bankId: string): Promise<void> {
        const bank = await this.dataSource.getRepository(Bank).findOne({ where: { id: bankId } });

        if (!bank) {
            throw CustomError.notFound('Bank not found', 'BANK_NOT_FOUND', { exposeMessage: true });
        }

        if (bank.archivedAt) {
            throw new CustomError(409, 'BANK_ARCHIVED', 'This bank is archived', {
                exposeMessage: true,
            });
        }
    }
}

const accountNotFound = (): CustomError =>
    CustomError.notFound('Bank account not found', 'BANK_ACCOUNT_NOT_FOUND', {
        exposeMessage: true,
    });
