import type { DataSource, Repository } from 'typeorm';

import { Bank, BankAccount, CreditCard } from '../../../src/accounts';
import { Expense, ExpenseType } from '../../../src/expenses';
import {
    CreditCardRefund,
    CreditCardStatement,
    CreditCardStatementPayment,
} from '../../../src/statements';
import { createIsolatedDataSource, dropIsolatedDataSource } from '../database.helper';

const SCHEMA = 'test_statements_schema';

describe('schema de statements (spec 0013, Modelo)', () => {
    let dataSource: DataSource;
    let statements: Repository<CreditCardStatement>;
    let payments: Repository<CreditCardStatementPayment>;
    let refunds: Repository<CreditCardRefund>;
    let creditCardId: string;
    let bankAccountId: string;
    let expenseId: string;

    const newStatement = (overrides: Partial<CreditCardStatement> = {}) =>
        statements.create({
            creditCardId,
            startsOn: '2026-02-11',
            closesOn: '2026-03-10',
            dueOn: '2026-03-20',
            status: 'CLOSED',
            previousBalanceCents: -200,
            minimumPaymentCents: null,
            closedAt: new Date('2026-03-11T03:00:00.000Z'),
            ...overrides,
        });

    const newPayment = (overrides: Partial<CreditCardStatementPayment> = {}) =>
        payments.create({
            creditCardId,
            statementId: null,
            bankAccountId,
            amountCents: 50000,
            paidOn: '2026-03-15',
            ...overrides,
        });

    const newRefund = (overrides: Partial<CreditCardRefund> = {}) =>
        refunds.create({
            creditCardId,
            expenseId: null,
            description: 'Estorno de teste',
            amountCents: 20000,
            occurredOn: '2026-03-01',
            postedOn: '2026-03-02',
            notes: null,
            ...overrides,
        });

    beforeAll(async () => {
        dataSource = await createIsolatedDataSource(SCHEMA);
        await dataSource.runMigrations();
        statements = dataSource.getRepository(CreditCardStatement);
        payments = dataSource.getRepository(CreditCardStatementPayment);
        refunds = dataSource.getRepository(CreditCardRefund);

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
        creditCardId = (
            await dataSource.getRepository(CreditCard).save({
                bankId: bank.id,
                name: 'Cartão de teste',
                creditLimitCents: 500000,
                availableLimitCents: 500000,
                closingDay: 10,
                dueDay: 20,
                archivedAt: null,
            })
        ).id;
        const expenseTypeId = (
            await dataSource.getRepository(ExpenseType).findOneByOrFail({ name: 'Outros' })
        ).id;
        expenseId = (
            await dataSource.getRepository(Expense).save({
                description: 'Compra de teste',
                expenseTypeId,
                kind: 'VARIABLE',
                status: 'OPEN',
                amountCents: 50000,
                occurredOn: '2026-03-01',
                paidOn: null,
                bankAccountId: null,
                creditCardId,
                postedOn: '2026-03-01',
                installmentGroupId: null,
                installmentNumber: null,
                installmentTotal: null,
                notes: null,
            })
        ).id;
    });

    afterAll(async () => {
        await dropIsolatedDataSource(dataSource, SCHEMA);
    });

    afterEach(async () => {
        await dataSource.query('DELETE FROM credit_card_statement_payments');
        await dataSource.query('DELETE FROM credit_card_refunds');
        await dataSource.query('DELETE FROM credit_card_statements');
    });

    it.each([
        ['credit_card_statements', CreditCardStatement],
        ['credit_card_statement_payments', CreditCardStatementPayment],
        ['credit_card_refunds', CreditCardRefund],
    ])(
        '%s: created_at/updated_at têm no ORM o mesmo default `now()` da migration (spec 0003)',
        async (table, entity) => {
            const rows = await dataSource.query<{ column_name: string; column_default: string }[]>(
                `SELECT column_name, column_default FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = $1
                   AND column_name IN ('created_at', 'updated_at')`,
                [table],
            );
            expect(rows).toHaveLength(2);
            for (const row of rows) expect(row.column_default).toBe('now()');

            for (const propertyName of ['createdAt', 'updatedAt']) {
                const column = dataSource
                    .getMetadata(entity)
                    .findColumnWithPropertyName(propertyName);
                expect(typeof column?.default === 'function' && column.default()).toBe('now()');
            }
        },
    );

    describe('credit_card_statements', () => {
        it('faz round-trip com datas, centavos (inclusive negativos) e timestamps (INV-0000-04)', async () => {
            const saved = await statements.save(
                newStatement({ minimumPaymentCents: 30000, previousBalanceCents: -200 }),
            );

            const found = await statements.findOneByOrFail({ id: saved.id });

            expect(found).toMatchObject({
                creditCardId,
                startsOn: '2026-02-11',
                closesOn: '2026-03-10',
                dueOn: '2026-03-20',
                status: 'CLOSED',
                previousBalanceCents: -200,
                minimumPaymentCents: 30000,
            });
            expect(found.closedAt.toISOString()).toBe('2026-03-11T03:00:00.000Z');
            expect(found.createdAt).toBeInstanceOf(Date);
            expect(found.updatedAt).toBeInstanceOf(Date);
        });

        it('o mínimo é opcional e a tabela não tem coluna de total nem de valor pago', async () => {
            const saved = await statements.save(newStatement());
            expect(
                (await statements.findOneByOrFail({ id: saved.id })).minimumPaymentCents,
            ).toBeNull();

            const columns = await dataSource.query<{ column_name: string }[]>(
                `SELECT column_name FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'credit_card_statements'`,
            );
            const names = columns.map((column) => column.column_name);
            expect(names).not.toEqual(expect.arrayContaining(['total_cents']));
            expect(names).not.toEqual(expect.arrayContaining(['paid_cents']));
        });

        it('status fora de CLOSED/PAID/ROLLED_OVER é recusado (ck_..._status)', async () => {
            await expect(
                statements.save(newStatement({ status: 'OPEN' as never })),
            ).rejects.toThrow(/ck_credit_card_statements_status/);
        });

        it('mínimo negativo é recusado (ck_..._minimum_payment)', async () => {
            await expect(
                statements.save(newStatement({ minimumPaymentCents: -1 })),
            ).rejects.toThrow(/ck_credit_card_statements_minimum_payment/);
        });

        it.each([
            ['starts_on depois de closes_on', { startsOn: '2026-03-11' }],
            ['closes_on igual a due_on', { dueOn: '2026-03-10' }],
        ])('datas incoerentes são recusadas: %s (ck_..._dates)', async (_name, overrides) => {
            await expect(statements.save(newStatement(overrides))).rejects.toThrow(
                /ck_credit_card_statements_dates/,
            );
        });

        it('um ciclo é registrado uma vez só por cartão (INV-0013-07, uq closes_on e starts_on)', async () => {
            await statements.save(newStatement());

            await expect(statements.save(newStatement({ startsOn: '2026-02-01' }))).rejects.toThrow(
                /uq_credit_card_statements_credit_card_id_closes_on/,
            );
            await expect(
                statements.save(newStatement({ closesOn: '2026-03-12', dueOn: '2026-03-22' })),
            ).rejects.toThrow(/uq_credit_card_statements_credit_card_id_starts_on/);
        });

        it('o cartão é restrito: a fatura impede excluí-lo (fk on delete restrict)', async () => {
            // Cartão próprio: o do resto da suíte também tem despesa, e o Postgres
            // reportaria a primeira FK que encontrar.
            const other = await dataSource.getRepository(CreditCard).save({
                bankId: (await dataSource.getRepository(Bank).findOneByOrFail({})).id,
                name: 'Outro cartão',
                creditLimitCents: 100000,
                availableLimitCents: 100000,
                closingDay: 10,
                dueDay: 20,
                archivedAt: null,
            });
            await statements.save(newStatement({ creditCardId: other.id }));

            await expect(
                dataSource.query('DELETE FROM credit_cards WHERE id = $1', [other.id]),
            ).rejects.toThrow(/fk_credit_card_statements_credit_card_id/);
        });
    });

    describe('credit_card_statement_payments', () => {
        it('faz round-trip; statement_id nulo é o pagamento antecipado (INV-0013-14)', async () => {
            const saved = await payments.save(newPayment());

            const found = await payments.findOneByOrFail({ id: saved.id });

            expect(found).toMatchObject({
                creditCardId,
                statementId: null,
                bankAccountId,
                amountCents: 50000,
                paidOn: '2026-03-15',
            });
            expect(found.createdAt).toBeInstanceOf(Date);
        });

        it('aponta para a fatura e a restringe contra exclusão (fk statement_id)', async () => {
            const statement = await statements.save(newStatement());
            const saved = await payments.save(newPayment({ statementId: statement.id }));

            expect((await payments.findOneByOrFail({ id: saved.id })).statementId).toBe(
                statement.id,
            );
            await expect(
                dataSource.query('DELETE FROM credit_card_statements WHERE id = $1', [
                    statement.id,
                ]),
            ).rejects.toThrow(/fk_credit_card_statement_payments_statement_id/);
        });

        it.each([0, -100])('valor %i é recusado (ck_..._amount)', async (amountCents) => {
            await expect(payments.save(newPayment({ amountCents }))).rejects.toThrow(
                /ck_credit_card_statement_payments_amount/,
            );
        });

        it('a conta é obrigatória e restrita (fk bank_account_id)', async () => {
            await payments.save(newPayment());

            await expect(
                dataSource.query('DELETE FROM bank_accounts WHERE id = $1', [bankAccountId]),
            ).rejects.toThrow(/fk_credit_card_statement_payments_bank_account_id/);
        });
    });

    describe('credit_card_refunds', () => {
        it('faz round-trip com datas e centavos (INV-0013-01)', async () => {
            const saved = await refunds.save(newRefund({ expenseId, notes: 'devolução parcial' }));

            expect(await refunds.findOneByOrFail({ id: saved.id })).toMatchObject({
                creditCardId,
                expenseId,
                description: 'Estorno de teste',
                amountCents: 20000,
                occurredOn: '2026-03-01',
                postedOn: '2026-03-02',
                notes: 'devolução parcial',
            });
        });

        it.each([0, -1])('valor %i é recusado (ck_..._amount)', async (amountCents) => {
            await expect(refunds.save(newRefund({ amountCents }))).rejects.toThrow(
                /ck_credit_card_refunds_amount/,
            );
        });

        it('posted_on antes de occurred_on é recusado (ck_..._posted_on)', async () => {
            await expect(
                refunds.save(newRefund({ occurredOn: '2026-03-05', postedOn: '2026-03-04' })),
            ).rejects.toThrow(/ck_credit_card_refunds_posted_on/);
        });

        it('excluir a despesa de origem mantém o estorno com expense_id nulo (on delete set null)', async () => {
            const saved = await refunds.save(newRefund({ expenseId }));

            await dataSource.query('DELETE FROM expenses WHERE id = $1', [expenseId]);

            expect((await refunds.findOneByOrFail({ id: saved.id })).expenseId).toBeNull();
        });
    });
});
