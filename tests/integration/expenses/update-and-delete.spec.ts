import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../app.helper';
import { businessToday } from '../../../src/platform';
import { ADMIN, cleanFixture, insertExpense, seedFixture, type Fixture } from './fixture.helper';

const SCHEMA = 'test_expenses_update_and_delete';

const dayAfter = (iso: string): string =>
    new Date(new Date(`${iso}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);

describe('despesa: alteração e exclusão (spec 0012)', () => {
    let ctx: TestApp;
    let fx: Fixture;

    const create = async (overrides: Record<string, unknown> = {}): Promise<string> =>
        (
            await request(ctx.app)
                .post('/expenses')
                .set('Authorization', ADMIN)
                .send({
                    description: 'Compra',
                    expenseTypeId: fx.typeId,
                    kind: 'VARIABLE',
                    amountCents: 1000,
                    occurredOn: '2026-03-10',
                    creditCardId: fx.cardId,
                    ...overrides,
                })
        ).body.data[0].id as string;

    const createOnAccount = (overrides: Record<string, unknown> = {}) =>
        create({ creditCardId: undefined, bankAccountId: fx.accountId, ...overrides });

    const patch = (id: string, body: Record<string, unknown>) =>
        request(ctx.app).patch(`/expenses/${id}`).set('Authorization', ADMIN).send(body);

    const remove = (id: string) =>
        request(ctx.app).delete(`/expenses/${id}`).set('Authorization', ADMIN);

    const pay = (id: string) =>
        request(ctx.app)
            .patch(`/expenses/${id}/status`)
            .set('Authorization', ADMIN)
            .send({ status: 'PAID' });

    const scalar = async (sql: string): Promise<number> =>
        Number(((await ctx.dataSource.query(sql)) as [{ v: string }])[0].v);

    const money = async (sql: string): Promise<number> => Math.round((await scalar(sql)) * 100);
    const limit = () => money('SELECT available_limit_cents AS v FROM credit_cards');
    const balance = () => money('SELECT current_balance_cents AS v FROM bank_accounts');
    const count = () => scalar('SELECT count(*) AS v FROM expenses');

    const setLimit = (cents: number) =>
        ctx.dataSource.query('UPDATE credit_cards SET available_limit_cents = $1', [cents / 100]);

    const insertGroup = async (
        overrides: (number: number) => Record<string, unknown>,
    ): Promise<string[]> => {
        const group = randomUUID();
        const ids: string[] = [];

        for (const number of [1, 2, 3]) {
            ids.push(
                await insertExpense(ctx, {
                    typeId: fx.typeId,
                    group: { id: group, number, total: 3 },
                    ...overrides(number),
                }),
            );
        }

        return ids;
    };

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        fx = await seedFixture(ctx);
    });

    afterEach(async () => {
        await cleanFixture(ctx);
    });

    describe('PATCH /expenses/:id', () => {
        it('AC-0012-13: alterar o valor de despesa de cartão OPEN de 1000 para 1500 abate mais 500 do limite', async () => {
            const id = await create();
            expect(await limit()).toBe(49000);

            const res = await patch(id, { amountCents: 1500 });

            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({ id, amountCents: 1500 });
            expect(await limit()).toBe(48500);
        });

        it('AC-0012-13: reduzir o valor devolve a diferença ao limite', async () => {
            const id = await create({ amountCents: 1500 });

            await patch(id, { amountCents: 1000 });

            expect(await limit()).toBe(49000);
        });

        it('alterar o valor de despesa FORECAST de cartão não move o limite', async () => {
            const id = await create({ status: 'FORECAST' });

            await patch(id, { amountCents: 1500 });

            expect(await limit()).toBe(50000);
        });

        it('altera descrição, tipo, data e notas de despesa de conta sem tocar o saldo; notes null limpa', async () => {
            const other = (
                await request(ctx.app)
                    .post('/expense-types')
                    .set('Authorization', ADMIN)
                    .send({ name: 'T-Lazer' })
            ).body.data.id as string;
            const id = await createOnAccount({ notes: 'x' });

            const res = await patch(id, {
                description: 'Nova',
                expenseTypeId: other,
                occurredOn: '2026-04-01',
                notes: null,
            });

            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({
                description: 'Nova',
                expenseType: { id: other },
                occurredOn: '2026-04-01',
                notes: null,
                postedOn: null,
            });
            expect(await balance()).toBe(100000);
        });

        it('ERR-0012-10, INV-0012-11: alterar o valor de despesa paga recebe 409 EXPENSE_ALREADY_PAID', async () => {
            const id = await createOnAccount();
            await pay(id);

            const res = await patch(id, { amountCents: 2000 });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('EXPENSE_ALREADY_PAID');
            expect(await balance()).toBe(99000);
            expect((await patch(id, { description: 'Só texto' })).status).toBe(200);
        });

        it.each(['bankAccountId', 'status', 'installmentTotal', 'kind', 'paidOn', 'creditCardId'])(
            'AC-0012-13, ERR-0012-11: %s recebe 400 VALIDATION_ERROR citando o campo',
            async (field) => {
                const id = await create();

                const res = await patch(id, { description: 'x', [field]: 'qualquer' });

                expect(res.status).toBe(400);
                expect(res.body.error.code).toBe('VALIDATION_ERROR');
                expect(JSON.stringify(res.body.error)).toContain(field);
            },
        );

        it('corpo vazio recebe 400', async () => {
            const id = await create();

            expect((await patch(id, {})).status).toBe(400);
        });

        it('ERR-0012-12: valor zero, negativo ou fracionário recebe 400', async () => {
            const id = await create();

            for (const amountCents of [0, -5, 10.5]) {
                const res = await patch(id, { amountCents });

                expect(res.status).toBe(400);
                expect(res.body.error.code).toBe('VALIDATION_ERROR');
            }
        });

        it('ERR-0012-17: postedOn em despesa de conta, ou anterior a occurredOn, recebe 400 citando o campo', async () => {
            const account = await createOnAccount();
            const card = await create();

            const onAccount = await patch(account, { postedOn: '2026-03-12' });
            const before = await patch(card, { postedOn: '2026-03-01' });

            for (const res of [onAccount, before]) {
                expect(res.status).toBe(400);
                expect(JSON.stringify(res.body.error)).toContain('postedOn');
            }
        });

        it('postedOn de cartão: grava o informado e, ao mudar occurredOn sozinho, recalcula pelo default', async () => {
            const today = businessToday();
            const id = await create({ occurredOn: today });

            const moved = await patch(id, { postedOn: dayAfter(today) });
            expect(moved.body.data.postedOn).toBe(dayAfter(today));

            const redated = await patch(id, { occurredOn: today });
            expect(redated.body.data).toMatchObject({
                occurredOn: today,
                postedOn: today,
            });
        });

        it('tipo arquivado é 409 EXPENSE_TYPE_ARCHIVED e inexistente é 404 EXPENSE_TYPE_NOT_FOUND', async () => {
            const id = await create();
            const archived = (
                await request(ctx.app)
                    .post('/expense-types')
                    .set('Authorization', ADMIN)
                    .send({ name: 'T-Velho' })
            ).body.data.id as string;
            await request(ctx.app)
                .post(`/expense-types/${archived}/archive`)
                .set('Authorization', ADMIN);

            const a = await patch(id, { expenseTypeId: archived });
            const b = await patch(id, { expenseTypeId: randomUUID() });

            expect([a.status, a.body.error.code]).toEqual([409, 'EXPENSE_TYPE_ARCHIVED']);
            expect([b.status, b.body.error.code]).toEqual([404, 'EXPENSE_TYPE_NOT_FOUND']);
        });

        it('altera só a parcela indicada', async () => {
            const ids = await insertGroup(() => ({ accountId: fx.accountId }));

            await patch(ids[1]!, { amountCents: 5000 });

            const rows = (await ctx.dataSource.query(
                'SELECT amount_cents AS v FROM expenses ORDER BY installment_number',
            )) as { v: string }[];
            expect(rows.map((row) => Math.round(Number(row.v) * 100))).toEqual([
                10000, 5000, 10000,
            ]);
        });
    });

    describe('DELETE /expenses/:id', () => {
        it('AC-0012-14: excluir despesa de cartão OPEN responde 204 e devolve o valor ao limite', async () => {
            const id = await create();
            expect(await limit()).toBe(49000);

            const res = await remove(id);

            expect(res.status).toBe(204);
            expect(await limit()).toBe(50000);
            expect(await count()).toBe(0);
        });

        it('excluir despesa FORECAST de cartão não move o limite', async () => {
            const id = await create({ status: 'FORECAST' });

            expect((await remove(id)).status).toBe(204);
            expect(await limit()).toBe(50000);
        });

        it('AC-0012-14, INV-0012-13: excluir uma parcela de cartão em 3x exclui as três e devolve a soma', async () => {
            const ids = await insertGroup(() => ({
                cardId: fx.cardId,
                occurredOn: businessToday(),
            }));
            await setLimit(20000);

            const res = await remove(ids[1]!);

            expect(res.status).toBe(204);
            expect(await count()).toBe(0);
            expect(await limit()).toBe(50000);
        });

        it('AC-0012-14, INV-0012-13: grupo de conta com a parcela 1 paga: excluir a 3 exclui 2 e 3, mantém a 1 e não move o saldo', async () => {
            const ids = await insertGroup((number) => ({
                accountId: fx.accountId,
                status: number === 1 ? 'PAID' : 'OPEN',
            }));

            const res = await remove(ids[2]!);

            expect(res.status).toBe(204);
            const rows = (await ctx.dataSource.query('SELECT id FROM expenses')) as {
                id: string;
            }[];
            expect(rows.map((row) => row.id)).toEqual([ids[0]]);
            expect(await balance()).toBe(100000);
        });

        it('INV-0012-13: excluir a própria parcela paga recebe 409 e nada é excluído', async () => {
            const ids = await insertGroup((number) => ({
                accountId: fx.accountId,
                status: number === 1 ? 'PAID' : 'OPEN',
            }));

            const res = await remove(ids[0]!);

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('EXPENSE_ALREADY_PAID');
            expect(await count()).toBe(3);
        });

        it('AC-0012-14, ERR-0012-10, INV-0012-11: excluir despesa paga recebe 409 EXPENSE_ALREADY_PAID', async () => {
            const id = await createOnAccount();
            await pay(id);

            const res = await remove(id);

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('EXPENSE_ALREADY_PAID');
            expect(await count()).toBe(1);
            expect(await balance()).toBe(99000);
        });

        it('ERR-0012-02: id inexistente recebe 404 EXPENSE_NOT_FOUND em PATCH e DELETE', async () => {
            const missing = randomUUID();

            for (const res of [await patch(missing, { description: 'x' }), await remove(missing)]) {
                expect(res.status).toBe(404);
                expect(res.body.error.code).toBe('EXPENSE_NOT_FOUND');
            }
        });

        it('exclusões concorrentes de parcelas do mesmo grupo devolvem o limite uma só vez', async () => {
            const ids = await insertGroup(() => ({
                cardId: fx.cardId,
                occurredOn: businessToday(),
            }));
            await setLimit(20000);

            const results = await Promise.all(ids.map((id) => remove(id)));

            expect(await count()).toBe(0);
            expect(await limit()).toBe(50000);
            expect(results.filter((res) => res.status === 204)).not.toHaveLength(0);
            for (const res of results) expect([204, 404]).toContain(res.status);
        }, 30000);
    });
});
