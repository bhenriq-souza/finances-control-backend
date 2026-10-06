import { randomUUID } from 'node:crypto';

import type { DataSource, Repository } from 'typeorm';

import { Bank, BankAccount } from '../../../src/accounts';
import { Earning, EarningType } from '../../../src/earnings';
import { createIsolatedDataSource, dropIsolatedDataSource } from '../database.helper';

const SCHEMA = 'test_earnings_schema';

describe('schema de earnings (spec 0014)', () => {
    let dataSource: DataSource;
    let earnings: Repository<Earning>;
    let earningTypeId: string;
    let bankAccountId: string;

    const newEarning = (overrides: Partial<Earning> = {}): Partial<Earning> => ({
        description: 'Salário de teste',
        earningTypeId,
        kind: 'VARIABLE',
        status: 'OPEN',
        amountCents: 350000,
        occurredOn: '2026-10-05',
        receivedOn: null,
        bankAccountId,
        installmentGroupId: null,
        installmentNumber: null,
        installmentTotal: null,
        notes: null,
        ...overrides,
    });

    const save = (overrides: Partial<Earning> = {}): Promise<Earning> =>
        earnings.save(earnings.create(newEarning(overrides)));

    beforeAll(async () => {
        dataSource = await createIsolatedDataSource(SCHEMA);
        await dataSource.runMigrations();
        earnings = dataSource.getRepository(Earning);

        const bank = await dataSource
            .getRepository(Bank)
            .save({ febrabanCode: '260', name: 'Banco de Teste', archivedAt: null });
        bankAccountId = (
            await dataSource.getRepository(BankAccount).save({
                bankId: bank.id,
                type: 'CHECKING',
                accountNumber: '1-1',
                description: 'Conta de teste',
                openingBalanceCents: 0,
                currentBalanceCents: 0,
                overdraftLimitCents: 0,
                archivedAt: null,
            })
        ).id;
        earningTypeId = (
            await dataSource.getRepository(EarningType).findOneByOrFail({
                name: 'Outros',
            })
        ).id;
    });

    afterAll(async () => {
        await dropIsolatedDataSource(dataSource, SCHEMA);
    });

    afterEach(async () => {
        await dataSource.query('DELETE FROM earnings');
    });

    describe('dinheiro (INV-0014-01, AC-0014-13)', () => {
        it('preserva o inteiro de centavos na ida e na volta', async () => {
            const saved = await save({ amountCents: 123456789 });

            const stored = await earnings.findOneByOrFail({ id: saved.id });
            expect(stored.amountCents).toBe(123456789);
            expect(Number.isInteger(stored.amountCents)).toBe(true);
        });

        it('a coluna é numeric(14,2): o banco nunca guarda mais de duas casas', async () => {
            await save({ amountCents: 5 });

            const [row] = await dataSource.query<{ amount_cents: string }[]>(
                'SELECT amount_cents FROM earnings LIMIT 1',
            );
            expect(row?.amount_cents).toBe('0.05');

            const [column] = await dataSource.query<
                { numeric_precision: number; numeric_scale: number }[]
            >(
                `SELECT numeric_precision, numeric_scale FROM information_schema.columns
                 WHERE table_schema = current_schema()
                   AND table_name = 'earnings' AND column_name = 'amount_cents'`,
            );
            expect(column).toEqual({ numeric_precision: 14, numeric_scale: 2 });
        });

        it('o transformer recusa fração de centavo', async () => {
            await expect(save({ amountCents: 10.5 })).rejects.toThrow(/integer number of cents/);
        });

        it.each([0, -1])('recusa valor %d (ck_earnings_amount)', async (amountCents) => {
            await expect(save({ amountCents })).rejects.toThrow(/ck_earnings_amount/);
        });
    });

    describe('conta (INV-0014-02)', () => {
        it('recusa receita sem conta', async () => {
            await expect(save({ bankAccountId: null as unknown as string })).rejects.toThrow(
                /bank_account_id/,
            );
        });

        it('recusa conta inexistente', async () => {
            await expect(save({ bankAccountId: randomUUID() })).rejects.toThrow(
                /fk_earnings_bank_account_id/,
            );
        });

        it('não deixa excluir a conta que tem receita', async () => {
            await save();

            await expect(
                dataSource.query('DELETE FROM bank_accounts WHERE id = $1', [bankAccountId]),
            ).rejects.toThrow(/fk_earnings_bank_account_id/);
        });
    });

    describe('received_on (INV-0014-04)', () => {
        it('aceita RECEIVED com received_on', async () => {
            const saved = await save({ status: 'RECEIVED', receivedOn: '2026-10-06' });

            expect((await earnings.findOneByOrFail({ id: saved.id })).receivedOn).toBe(
                '2026-10-06',
            );
        });

        it('recusa RECEIVED sem received_on', async () => {
            await expect(save({ status: 'RECEIVED', receivedOn: null })).rejects.toThrow(
                /ck_earnings_received_on/,
            );
        });

        it.each(['OPEN', 'FORECAST', 'OVERDUE', 'VERIFYING'] as const)(
            'recusa %s com received_on',
            async (status) => {
                await expect(save({ status, receivedOn: '2026-10-06' })).rejects.toThrow(
                    /ck_earnings_received_on/,
                );
            },
        );

        it.each(['OPEN', 'FORECAST', 'OVERDUE', 'VERIFYING'] as const)(
            'aceita %s sem received_on',
            async (status) => {
                await expect(save({ status })).resolves.toBeDefined();
            },
        );
    });

    describe('enumerados', () => {
        it('recusa kind fora do enum', async () => {
            await expect(save({ kind: 'WEEKLY' as never })).rejects.toThrow(/ck_earnings_kind/);
        });

        it('recusa status fora do enum', async () => {
            await expect(save({ status: 'PAID' as never })).rejects.toThrow(/ck_earnings_status/);
        });
    });

    describe('parcelamento', () => {
        const installment = (overrides: Partial<Earning> = {}): Partial<Earning> => ({
            kind: 'INSTALLMENT',
            installmentGroupId: randomUUID(),
            installmentNumber: 1,
            installmentTotal: 3,
            ...overrides,
        });

        it('aceita parcela completa', async () => {
            await expect(save(installment())).resolves.toBeDefined();
        });

        it.each([
            ['total 1', { installmentTotal: 1, installmentNumber: 1 }],
            ['número 0', { installmentNumber: 0 }],
            ['número acima do total', { installmentNumber: 4 }],
            ['sem grupo', { installmentGroupId: null }],
            ['sem número', { installmentNumber: null }],
            ['sem total', { installmentTotal: null }],
        ])('recusa INSTALLMENT com %s', async (_label, overrides) => {
            await expect(save(installment(overrides))).rejects.toThrow(/ck_earnings_installment/);
        });

        it.each(['FIXED', 'VARIABLE'] as const)(
            'recusa %s com colunas de parcela',
            async (kind) => {
                await expect(
                    save({
                        kind,
                        installmentGroupId: randomUUID(),
                        installmentNumber: 1,
                        installmentTotal: 3,
                    }),
                ).rejects.toThrow(/ck_earnings_installment/);
            },
        );

        it('recusa o mesmo número no mesmo grupo', async () => {
            const installmentGroupId = randomUUID();
            await save(installment({ installmentGroupId }));

            await expect(save(installment({ installmentGroupId }))).rejects.toThrow(
                /uq_earnings_installment_group_id_installment_number/,
            );
        });
    });

    describe('tipos pré-definidos', () => {
        it('a unicidade de name é case-insensitive', async () => {
            await expect(
                dataSource.query("INSERT INTO earning_types (name) VALUES ('OUTROS')"),
            ).rejects.toThrow(/uq_earning_types_name/);
        });
    });
});
