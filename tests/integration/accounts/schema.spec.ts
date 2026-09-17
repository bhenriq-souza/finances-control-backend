import type { DataSource, Repository } from 'typeorm';

import { Bank, BankAccount, CreditCard } from '../../../src/accounts';
import { createIsolatedDataSource, dropIsolatedDataSource } from '../database.helper';

const SCHEMA = 'test_accounts_schema';

const newBank = (overrides: Partial<Bank> = {}): Partial<Bank> => ({
    febrabanCode: String(Math.floor(Math.random() * 900) + 100),
    name: 'Banco de Teste',
    archivedAt: null,
    ...overrides,
});

const newAccount = (
    bankId: string,
    overrides: Partial<BankAccount> = {},
): Partial<BankAccount> => ({
    bankId,
    type: 'CHECKING',
    accountNumber: `${Math.floor(Math.random() * 100000)}-1`,
    description: 'Conta de teste',
    openingBalanceCents: 150000,
    currentBalanceCents: 150000,
    overdraftLimitCents: 0,
    archivedAt: null,
    ...overrides,
});

const newCard = (bankId: string, overrides: Partial<CreditCard> = {}): Partial<CreditCard> => ({
    bankId,
    name: `Cartão ${Math.random().toString(36).slice(2, 7)}`,
    creditLimitCents: 500000,
    availableLimitCents: 500000,
    closingDay: 28,
    dueDay: 5,
    archivedAt: null,
    ...overrides,
});

describe('schema de accounts (spec 0011)', () => {
    let dataSource: DataSource;
    let banks: Repository<Bank>;
    let accounts: Repository<BankAccount>;
    let cards: Repository<CreditCard>;
    let bankId: string;

    beforeAll(async () => {
        dataSource = await createIsolatedDataSource(SCHEMA);
        await dataSource.runMigrations();
        banks = dataSource.getRepository(Bank);
        accounts = dataSource.getRepository(BankAccount);
        cards = dataSource.getRepository(CreditCard);
    });

    afterAll(async () => {
        await dropIsolatedDataSource(dataSource, SCHEMA);
    });

    beforeEach(async () => {
        bankId = (await banks.save(banks.create(newBank({ febrabanCode: '260' })))).id;
    });

    afterEach(async () => {
        await dataSource.query('DELETE FROM credit_cards');
        await dataSource.query('DELETE FROM bank_accounts');
        await dataSource.query('DELETE FROM banks');
    });

    describe('constraints nomeadas pela convenção da spec 0003', () => {
        it.each([
            ['banks', ['ck_banks_febraban_code', 'pk_banks', 'uq_banks_febraban_code']],
            [
                'bank_accounts',
                [
                    'ck_bank_accounts_overdraft_limit',
                    'ck_bank_accounts_type',
                    'fk_bank_accounts_bank_id',
                    'pk_bank_accounts',
                    'uq_bank_accounts_bank_id_account_number',
                ],
            ],
            [
                'credit_cards',
                [
                    'ck_credit_cards_closing_day',
                    'ck_credit_cards_credit_limit',
                    'ck_credit_cards_due_day',
                    'fk_credit_cards_bank_id',
                    'pk_credit_cards',
                    'uq_credit_cards_bank_id_name',
                ],
            ],
        ])('%s', async (table, expected) => {
            const rows = await dataSource.query<{ conname: string }[]>(
                `SELECT con.conname FROM pg_constraint con
                 JOIN pg_class c ON c.oid = con.conrelid
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relname = $1 AND n.nspname = current_schema()
                 ORDER BY con.conname`,
                [table],
            );

            expect(rows.map((row) => row.conname)).toEqual(expected);
        });
    });

    describe('banks', () => {
        it('recusa código FEBRABAN fora de três dígitos', async () => {
            await expect(banks.save(banks.create(newBank({ febrabanCode: '26' })))).rejects.toThrow(
                /ck_banks_febraban_code/,
            );
            await expect(
                banks.save(banks.create(newBank({ febrabanCode: '26A' }))),
            ).rejects.toThrow(/ck_banks_febraban_code/);
        });

        it('recusa código repetido', async () => {
            await expect(
                banks.save(banks.create(newBank({ febrabanCode: '260' }))),
            ).rejects.toThrow(/uq_banks_febraban_code/);
        });

        it('aceita zeros à esquerda', async () => {
            const bank = await banks.save(banks.create(newBank({ febrabanCode: '001' })));

            expect((await banks.findOneByOrFail({ id: bank.id })).febrabanCode).toBe('001');
        });
    });

    describe('dinheiro atravessa como inteiro de centavos (INV-0011-01)', () => {
        it('preserva o valor na ida e na volta', async () => {
            const saved = await accounts.save(
                accounts.create(newAccount(bankId, { openingBalanceCents: 123456789 })),
            );

            const stored = await accounts.findOneByOrFail({ id: saved.id });
            expect(stored.openingBalanceCents).toBe(123456789);
            expect(Number.isInteger(stored.openingBalanceCents)).toBe(true);
        });

        it('a coluna guarda numeric com duas casas', async () => {
            await accounts.save(accounts.create(newAccount(bankId, { openingBalanceCents: 5 })));

            const [row] = await dataSource.query<{ opening_balance_cents: string }[]>(
                'SELECT opening_balance_cents FROM bank_accounts LIMIT 1',
            );

            expect(row?.opening_balance_cents).toBe('0.05');
        });

        it('aceita saldo negativo: cheque especial existe', async () => {
            const saved = await accounts.save(
                accounts.create(newAccount(bankId, { currentBalanceCents: -25000 })),
            );

            expect((await accounts.findOneByOrFail({ id: saved.id })).currentBalanceCents).toBe(
                -25000,
            );
        });

        it('recusa limite de cheque especial negativo', async () => {
            await expect(
                accounts.save(accounts.create(newAccount(bankId, { overdraftLimitCents: -1 }))),
            ).rejects.toThrow(/ck_bank_accounts_overdraft_limit/);
        });
    });

    describe('bank_accounts', () => {
        it.each(['CHECKING', 'SAVINGS', 'INVESTMENT'] as const)(
            'aceita o tipo %s',
            async (type) => {
                const saved = await accounts.save(accounts.create(newAccount(bankId, { type })));

                expect((await accounts.findOneByOrFail({ id: saved.id })).type).toBe(type);
            },
        );

        it('recusa tipo fora do enum', async () => {
            await expect(
                dataSource.query(
                    `INSERT INTO bank_accounts
                     (bank_id, type, account_number, description, opening_balance_cents, current_balance_cents)
                     VALUES ($1, 'POUPANCA', '1', 'x', 0, 0)`,
                    [bankId],
                ),
            ).rejects.toThrow(/ck_bank_accounts_type/);
        });

        it('recusa a mesma conta no mesmo banco', async () => {
            await accounts.save(accounts.create(newAccount(bankId, { accountNumber: '12345-6' })));

            await expect(
                accounts.save(accounts.create(newAccount(bankId, { accountNumber: '12345-6' }))),
            ).rejects.toThrow(/uq_bank_accounts_bank_id_account_number/);
        });

        it('aceita o mesmo número em bancos diferentes (AC-0011-03)', async () => {
            const other = await banks.save(banks.create(newBank({ febrabanCode: '237' })));
            await accounts.save(accounts.create(newAccount(bankId, { accountNumber: '12345-6' })));

            const saved = await accounts.save(
                accounts.create(newAccount(other.id, { accountNumber: '12345-6' })),
            );

            expect(saved.id).toBeDefined();
        });

        it('aplica o default zero no cheque especial', async () => {
            await dataSource.query(
                `INSERT INTO bank_accounts
                 (bank_id, type, account_number, description, opening_balance_cents, current_balance_cents)
                 VALUES ($1, 'CHECKING', '9-9', 'sem cheque especial', 0, 0)`,
                [bankId],
            );

            const stored = await accounts.findOneByOrFail({ accountNumber: '9-9' });
            expect(stored.overdraftLimitCents).toBe(0);
        });
    });

    describe('credit_cards', () => {
        it('recusa limite zero ou negativo', async () => {
            await expect(
                cards.save(cards.create(newCard(bankId, { creditLimitCents: 0 }))),
            ).rejects.toThrow(/ck_credit_cards_credit_limit/);
        });

        it.each([0, 32])('recusa dia de fechamento %i', async (closingDay) => {
            await expect(cards.save(cards.create(newCard(bankId, { closingDay })))).rejects.toThrow(
                /ck_credit_cards_closing_day/,
            );
        });

        it('recusa dia de vencimento fora de 1 a 31', async () => {
            await expect(cards.save(cards.create(newCard(bankId, { dueDay: 32 })))).rejects.toThrow(
                /ck_credit_cards_due_day/,
            );
        });

        it('recusa o mesmo nome no mesmo banco', async () => {
            await cards.save(cards.create(newCard(bankId, { name: 'Platinum' })));

            await expect(
                cards.save(cards.create(newCard(bankId, { name: 'Platinum' }))),
            ).rejects.toThrow(/uq_credit_cards_bank_id_name/);
        });
    });

    describe('vínculo com o banco (INV-0011-02)', () => {
        it('impede apagar banco que tem conta', async () => {
            await accounts.save(accounts.create(newAccount(bankId)));

            await expect(banks.delete({ id: bankId })).rejects.toThrow(/fk_bank_accounts_bank_id/);
        });

        it('impede apagar banco que tem cartão', async () => {
            await cards.save(cards.create(newCard(bankId)));

            await expect(banks.delete({ id: bankId })).rejects.toThrow(/fk_credit_cards_bank_id/);
        });

        it('exige banco existente', async () => {
            await expect(
                accounts.save(accounts.create(newAccount('00000000-0000-4000-8000-000000000000'))),
            ).rejects.toThrow(/fk_bank_accounts_bank_id/);
        });
    });

    describe('trigger de updated_at', () => {
        it.each(['banks', 'bank_accounts', 'credit_cards'])(
            'avança updated_at em %s, mesmo fora do ORM',
            async (table) => {
                const id =
                    table === 'banks'
                        ? bankId
                        : table === 'bank_accounts'
                          ? (await accounts.save(accounts.create(newAccount(bankId)))).id
                          : (await cards.save(cards.create(newCard(bankId)))).id;

                const [before] = await dataSource.query<{ updated_at: Date }[]>(
                    `SELECT updated_at FROM ${table} WHERE id = $1`,
                    [id],
                );

                await dataSource.query(`UPDATE ${table} SET archived_at = now() WHERE id = $1`, [
                    id,
                ]);

                const [after] = await dataSource.query<{ updated_at: Date }[]>(
                    `SELECT updated_at FROM ${table} WHERE id = $1`,
                    [id],
                );

                expect(after!.updated_at.getTime()).toBeGreaterThan(before!.updated_at.getTime());
            },
        );
    });
});
