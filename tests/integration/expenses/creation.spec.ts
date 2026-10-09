import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../app.helper';
import { businessToday } from '../../../src/platform';

const SCHEMA = 'test_expenses_creation';
const dayAfter = (iso: string): string =>
    new Date(new Date(`${iso}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
const ADMIN = 'Bearer uid-admin';
const MISSING = '00000000-0000-4000-8000-000000000000';

describe('POST /expenses (spec 0012, criação)', () => {
    let ctx: TestApp;
    let bankId: string;
    let accountId: string;
    let cardId: string;
    let typeId: string;

    const send = (path: string, body: Record<string, unknown>) =>
        request(ctx.app).post(path).set('Authorization', ADMIN).send(body);

    const create = (overrides: Record<string, unknown> = {}) =>
        send('/expenses', {
            description: 'Aluguel',
            expenseTypeId: typeId,
            kind: 'VARIABLE',
            amountCents: 150000,
            occurredOn: '2026-03-10',
            bankAccountId: accountId,
            ...overrides,
        });

    const cardExpense = (overrides: Record<string, unknown> = {}) =>
        create({ bankAccountId: undefined, creditCardId: cardId, ...overrides });

    const makeAccount = async (accountNumber: string): Promise<string> => {
        const { body } = await send('/bank-accounts', {
            bankId,
            type: 'CHECKING',
            accountNumber,
            description: `Conta ${accountNumber}`,
            openingBalanceCents: 100000,
        });

        return body.data.id as string;
    };

    const makeCard = async (name: string): Promise<string> => {
        const { body } = await send('/credit-cards', {
            bankId,
            name,
            creditLimitCents: 500000,
            closingDay: 28,
            dueDay: 5,
        });

        return body.data.id as string;
    };

    const makeType = async (name: string): Promise<string> => {
        const { body } = await send('/expense-types', { name });

        return body.data.id as string;
    };

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        await request(ctx.app).get('/users/me').set('Authorization', ADMIN);
        await ctx.setProfile('uid-admin', 'ADMIN');

        const { body } = await send('/banks', { febrabanCode: '260', name: 'Nu Pagamentos' });
        bankId = body.data.id as string;
        accountId = await makeAccount('1-1');
        cardId = await makeCard('Platinum');
        typeId = await makeType('T-Casa');
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM expenses');
        await ctx.dataSource.query('DELETE FROM expense_recurrences');
        await ctx.dataSource.query("DELETE FROM expense_types WHERE name LIKE 'T-%'");
        await ctx.dataSource.query('DELETE FROM credit_cards');
        await ctx.dataSource.query('DELETE FROM bank_accounts');
        await ctx.dataSource.query('DELETE FROM banks');
    });

    describe('corpo da resposta', () => {
        it('devolve 201 com lista de um elemento no formato ExpenseResponse', async () => {
            const res = await create({ notes: 'dia 10' });

            expect(res.status).toBe(201);
            expect(res.body.data).toEqual([
                {
                    id: expect.any(String),
                    description: 'Aluguel',
                    kind: 'VARIABLE',
                    status: 'OPEN',
                    amountCents: 150000,
                    occurredOn: '2026-03-10',
                    paidOn: null,
                    notes: 'dia 10',
                    expenseType: {
                        id: typeId,
                        name: 'T-Casa',
                        archivedAt: null,
                        createdAt: expect.any(String),
                    },
                    bankAccountId: accountId,
                    creditCardId: null,
                    postedOn: null,
                    installment: null,
                    createdAt: expect.any(String),
                    updatedAt: expect.any(String),
                },
            ]);
        });

        it('aceita FIXED e os status FORECAST e VERIFYING', async () => {
            for (const [kind, status] of [
                ['FIXED', 'FORECAST'],
                ['FIXED', 'VERIFYING'],
            ]) {
                const res = await create({ kind, status });

                expect(res.status).toBe(201);
                expect(res.body.data[0]).toMatchObject({ kind, status });
            }
        });
    });

    describe('postedOn (AC-0012-21, INV-0012-14, ERR-0012-17)', () => {
        it('AC-0012-21: despesa de cartão sem postedOn nasce com postedOn igual a occurredOn', async () => {
            const today = businessToday();
            const res = await cardExpense({ occurredOn: today });

            expect(res.status).toBe(201);
            expect(res.body.data[0]).toMatchObject({
                creditCardId: cardId,
                bankAccountId: null,
                occurredOn: today,
                postedOn: today,
            });
        });

        it('AC-0012-21: postedOn posterior a occurredOn grava o informado', async () => {
            const today = businessToday();
            const res = await cardExpense({ occurredOn: today, postedOn: dayAfter(today) });

            expect(res.status).toBe(201);
            expect(res.body.data[0].postedOn).toBe(dayAfter(today));
        });

        it('AC-0012-21, ERR-0012-17: postedOn anterior a occurredOn é 400 citando o campo', async () => {
            const res = await cardExpense({ postedOn: '2026-03-09' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(JSON.stringify(res.body)).toContain('postedOn');
        });

        it('AC-0012-21, ERR-0012-17: postedOn em despesa de conta é 400 citando o campo', async () => {
            const res = await create({ postedOn: '2026-03-10' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(JSON.stringify(res.body)).toContain('postedOn');
        });
    });

    describe('conta ou cartão (ERR-0012-03, ERR-0012-04, ERR-0012-05, AC-0012-15)', () => {
        it('ERR-0012-03: conta e cartão ao mesmo tempo é 400 citando os dois campos', async () => {
            const res = await create({ creditCardId: cardId });
            const body = JSON.stringify(res.body);

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(body).toContain('bankAccountId');
            expect(body).toContain('creditCardId');
        });

        it('ERR-0012-03: nem conta nem cartão é 400 citando os dois campos', async () => {
            const res = await create({ bankAccountId: undefined });
            const body = JSON.stringify(res.body);

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(body).toContain('bankAccountId');
            expect(body).toContain('creditCardId');
        });

        it('ERR-0012-04: conta inexistente é 404 BANK_ACCOUNT_NOT_FOUND', async () => {
            const res = await create({ bankAccountId: MISSING });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
        });

        it('ERR-0012-04: cartão inexistente é 404 CREDIT_CARD_NOT_FOUND', async () => {
            const res = await cardExpense({ creditCardId: MISSING });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('CREDIT_CARD_NOT_FOUND');
        });

        it('ERR-0012-04: tipo inexistente é 404 EXPENSE_TYPE_NOT_FOUND', async () => {
            const res = await create({ expenseTypeId: MISSING });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('EXPENSE_TYPE_NOT_FOUND');
        });

        it('AC-0012-15, ERR-0012-05: conta arquivada é 409 BANK_ACCOUNT_ARCHIVED', async () => {
            await send(`/bank-accounts/${accountId}/archive`, {});

            const res = await create();

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('BANK_ACCOUNT_ARCHIVED');
        });

        it('AC-0012-15, ERR-0012-05: cartão arquivado é 409 CREDIT_CARD_ARCHIVED e o limite não muda', async () => {
            await send(`/credit-cards/${cardId}/archive`, {});

            const res = await cardExpense();

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('CREDIT_CARD_ARCHIVED');
            await expect(
                ctx.dataSource.query('SELECT count(*)::int AS n FROM expenses'),
            ).resolves.toEqual([{ n: 0 }]);
        });

        it('AC-0012-15, ERR-0012-06: tipo arquivado é 409 EXPENSE_TYPE_ARCHIVED', async () => {
            await send(`/expense-types/${typeId}/archive`, {});

            const res = await create();

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('EXPENSE_TYPE_ARCHIVED');
        });
    });

    describe('validação do corpo (ERR-0012-07, ERR-0012-12, ERR-0012-14)', () => {
        it.each([
            ['zero', 0],
            ['negativo', -100],
            ['fração de centavo', 10.5],
            ['texto', '100'],
        ])('ERR-0012-12: amountCents %s é 400 e nada é gravado', async (_name, amountCents) => {
            const res = await create({ amountCents });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            await expect(
                ctx.dataSource.query('SELECT count(*)::int AS n FROM expenses'),
            ).resolves.toEqual([{ n: 0 }]);
        });

        it.each(['PAID', 'OVERDUE', 'DONE'])(
            'ERR-0012-14: status %s na criação é 400',
            async (status) => {
                const res = await create({ status });

                expect(res.status).toBe(400);
                expect(res.body.error.code).toBe('VALIDATION_ERROR');
            },
        );

        it('ERR-0012-07: installmentTotal em FIXED/VARIABLE é 400 citando o campo', async () => {
            const res = await create({ installmentTotal: 3 });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(JSON.stringify(res.body)).toContain('installmentTotal');
        });

        it('recusa campo desconhecido, como saldo ou paidOn', async () => {
            const res = await create({ paidOn: '2026-03-10' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('recusa data impossível', async () => {
            const res = await create({ occurredOn: '2026-02-30' });

            expect(res.status).toBe(400);
        });
    });

    describe('CHECKs do banco (INV-0012-01, INV-0012-02)', () => {
        const insert = (columns: string, values: unknown[]) =>
            ctx.dataSource.query(
                `INSERT INTO expenses (description, expense_type_id, kind, status, occurred_on, ${columns})
                 VALUES ('x', $1, 'VARIABLE', 'OPEN', '2026-03-10', ${values.map((_, i) => `$${i + 2}`).join(', ')})`,
                [typeId, ...values],
            );

        it('INV-0012-02: despesa com conta e cartão juntos é recusada pelo banco', async () => {
            await expect(
                insert('amount_cents, bank_account_id, credit_card_id, posted_on', [
                    10,
                    accountId,
                    cardId,
                    '2026-03-10',
                ]),
            ).rejects.toThrow('ck_expenses_owner');
        });

        it('INV-0012-02: despesa sem conta nem cartão é recusada pelo banco', async () => {
            await expect(insert('amount_cents', [10])).rejects.toThrow('ck_expenses_owner');
        });

        it('INV-0012-01: valor não positivo é recusado pelo banco', async () => {
            await expect(insert('amount_cents, bank_account_id', [0, accountId])).rejects.toThrow(
                'ck_expenses_amount',
            );
        });
    });
});
