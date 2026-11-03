import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import type { DataSource, EntityManager, Repository } from 'typeorm';

import {
    DatabaseConnectionSymbol,
    RequestContextSymbol,
    type RequestContext,
    archivedFilter,
    asConflict,
    needsArchiveChange,
} from '../platform';
import { BankAccount } from './bank-account.entity';
import type { BankAccountType } from './bank-account-type';
import { Bank } from './bank.entity';

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
    constructor(
        @inject(DatabaseConnectionSymbol) private readonly dataSource: DataSource,
        @inject(RequestContextSymbol) private readonly requestContext: RequestContext,
    ) {}

    private get accounts(): Repository<BankAccount> {
        return this.dataSource.getRepository(BankAccount);
    }

    list(query: { archived?: 'true' | 'false' } = {}): Promise<BankAccountWithBank[]> {
        const workspaceId = this.requestContext.requireWorkspaceId();

        return this.accounts.find({
            where: { ...archivedFilter(query), workspaceId },
            relations: { bank: true },
            order: { description: 'ASC' },
        }) as Promise<BankAccountWithBank[]>;
    }

    async findById(workspaceId: string, id: string): Promise<BankAccountWithBank> {
        const account = await this.accounts.findOne({
            where: { id, workspaceId },
            relations: { bank: true },
        });

        if (!account) throw accountNotFound();

        return account as BankAccountWithBank;
    }

    async create(data: CreateBankAccount): Promise<BankAccountWithBank> {
        await this.assertBankIsUsable(data.bankId);

        const workspaceId = this.requestContext.requireWorkspaceId();
        const created = await asConflict(
            this.accounts.save(
                this.accounts.create({
                    ...data,
                    workspaceId,
                    overdraftLimitCents: data.overdraftLimitCents ?? 0,
                    // Nasce igual ao de abertura, e daqui em diante só lançamento
                    // o move (INV-0011-04).
                    currentBalanceCents: data.openingBalanceCents,
                    archivedAt: null,
                }),
            ),
            CONFLICTS,
        );

        return this.findById(workspaceId, created.id);
    }

    async setArchived(id: string, archived: boolean): Promise<BankAccountWithBank> {
        const workspaceId = this.requestContext.requireWorkspaceId();
        const account = await this.findById(workspaceId, id);

        if (!needsArchiveChange(account.archivedAt, archived)) return account;

        await this.accounts.update(
            { id, workspaceId },
            { archivedAt: archived ? new Date() : null },
        );

        return this.findById(workspaceId, id);
    }

    async update(id: string, changes: UpdateBankAccount): Promise<BankAccountWithBank> {
        const workspaceId = this.requestContext.requireWorkspaceId();
        await this.findById(workspaceId, id);

        if (Object.keys(changes).length > 0) {
            await asConflict(this.accounts.update({ id, workspaceId }, changes), CONFLICTS);
        }

        return this.findById(workspaceId, id);
    }

    /**
     * Soma `deltaCents` (positivo ou negativo, nunca zero) ao saldo, na transação
     * de quem chamou: lê a linha com lock de escrita pelo `manager` recebido, o que
     * serializa movimentos concorrentes na mesma conta (ADR-0003, regra 4). O lock é
     * `FOR NO KEY UPDATE`, o mesmo do UPDATE de coluna não-chave: `FOR UPDATE`
     * conflitaria com o `FOR KEY SHARE` que a FK toma quando quem chamou já inseriu
     * uma linha filha (despesa, transferência), e duas dessas transações em paralelo
     * entrariam em deadlock. Não abre
     * transação (INV-0004-03). Conta arquivada aceita delta, e o saldo pode ficar
     * negativo: nem ele barra o lançamento (INV-0012-09).
     */
    async applyBalanceDelta(
        manager: EntityManager,
        workspaceId: string,
        id: string,
        deltaCents: number,
    ): Promise<void> {
        if (!Number.isSafeInteger(deltaCents) || deltaCents === 0) {
            throw new RangeError('deltaCents must be a non-zero integer');
        }

        const repository = manager.getRepository(BankAccount);
        const account = await repository.findOne({
            where: { id, workspaceId },
            lock: { mode: 'for_no_key_update' },
        });

        if (!account) throw accountNotFound();

        await repository.update(
            { id, workspaceId },
            { currentBalanceCents: account.currentBalanceCents + deltaCents },
        );
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
