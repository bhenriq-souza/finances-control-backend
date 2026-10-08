import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { container } from '../../../src/container';
import { ExpenseServiceSymbol, type ExpenseService } from '../../../src/expenses';
import { startApp, stopApp, type TestApp } from '../app.helper';
import { ADMIN, cleanFixture, insertExpense, seedFixture, type Fixture } from './fixture.helper';

const SCHEMA = 'test_expenses_listing';

describe('despesa: consulta e listagem (spec 0012)', () => {
    let ctx: TestApp;
    let fx: Fixture;

    const list = (query = '') =>
        request(ctx.app).get(`/expenses${query}`).set('Authorization', ADMIN);

    const ids = (res: request.Response): string[] =>
        res.body.data.map((row: { id: string }) => row.id);

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

    it('AC-0012-16: from, to e creditCardId devolvem só o cartão, na janela, em ordem de occurredOn', async () => {
        const base = { typeId: fx.typeId, cardId: fx.cardId };
        const late = await insertExpense(ctx, { ...base, occurredOn: '2026-03-30' });
        const early = await insertExpense(ctx, { ...base, occurredOn: '2026-03-01' });
        await insertExpense(ctx, { ...base, occurredOn: '2026-04-01' });
        await insertExpense(ctx, { ...base, occurredOn: '2026-02-28' });
        await insertExpense(ctx, {
            typeId: fx.typeId,
            accountId: fx.accountId,
            occurredOn: '2026-03-15',
        });

        const res = await list(`?from=2026-03-01&to=2026-03-31&creditCardId=${fx.cardId}`);

        expect(res.status).toBe(200);
        expect(ids(res)).toEqual([early, late]);
        expect(res.body.data[0]).toMatchObject({
            expenseType: { id: fx.typeId },
            creditCardId: fx.cardId,
            installment: null,
        });
    });

    it('sem filtro devolve tudo; os demais filtros combinam por E', async () => {
        const group = randomUUID();
        await insertExpense(ctx, {
            typeId: fx.typeId,
            accountId: fx.accountId,
            status: 'PAID',
            group: { id: group, number: 1, total: 2 },
        });
        const open = await insertExpense(ctx, {
            typeId: fx.typeId,
            accountId: fx.accountId,
            group: { id: group, number: 2, total: 2 },
        });
        await insertExpense(ctx, { typeId: fx.typeId, accountId: fx.accountId });

        expect((await list()).body.data).toHaveLength(3);
        expect((await list(`?installmentGroupId=${group}`)).body.data).toHaveLength(2);

        const combined = await list(
            `?installmentGroupId=${group}&status=OPEN&kind=INSTALLMENT&expenseTypeId=${fx.typeId}&bankAccountId=${fx.accountId}`,
        );
        expect(ids(combined)).toEqual([open]);
        expect(combined.body.data[0].installment).toEqual({ groupId: group, number: 2, total: 2 });
    });

    it('empate em occurredOn desempata por criação', async () => {
        const first = await insertExpense(ctx, { typeId: fx.typeId, accountId: fx.accountId });
        const second = await insertExpense(ctx, { typeId: fx.typeId, accountId: fx.accountId });

        expect(ids(await list())).toEqual([first, second]);
    });

    it('ERR-0012-15: from > to recebe 400 VALIDATION_ERROR', async () => {
        const res = await list('?from=2026-04-01&to=2026-03-01');

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it.each(['status=ZZZ', 'kind=ZZZ', 'from=ontem', 'creditCardId=nao-uuid', 'foo=1'])(
        'filtro inválido %s recebe 400 citando o campo',
        async (query) => {
            const res = await list(`?${query}`);

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(JSON.stringify(res.body.error)).toContain(query.split('=')[0]);
        },
    );

    it('GET /expenses/:id devolve a despesa; inexistente é 404 EXPENSE_NOT_FOUND; id malformado é 400', async () => {
        const id = await insertExpense(ctx, { typeId: fx.typeId, accountId: fx.accountId });

        const found = await request(ctx.app).get(`/expenses/${id}`).set('Authorization', ADMIN);
        expect(found.status).toBe(200);
        expect(found.body.data).toMatchObject({ id, bankAccountId: fx.accountId });

        const missing = await request(ctx.app)
            .get(`/expenses/${randomUUID()}`)
            .set('Authorization', ADMIN);
        expect([missing.status, missing.body.error.code]).toEqual([404, 'EXPENSE_NOT_FOUND']);

        const bad = await request(ctx.app).get('/expenses/xyz').set('Authorization', ADMIN);
        expect(bad.status).toBe(400);
    });

    it('listByCreditCard devolve as despesas do cartão com posted_on na janela inclusiva, por posted_on', async () => {
        const service = container.resolve<ExpenseService>(ExpenseServiceSymbol);
        const base = { typeId: fx.typeId, cardId: fx.cardId };
        const last = await insertExpense(ctx, { ...base, occurredOn: '2026-03-31' });
        const first = await insertExpense(ctx, { ...base, occurredOn: '2026-03-01' });
        await insertExpense(ctx, { ...base, occurredOn: '2026-04-01' });
        await insertExpense(ctx, {
            typeId: fx.typeId,
            accountId: fx.accountId,
            occurredOn: '2026-03-10',
        });

        const rows = await service.listByCreditCard(fx.cardId, {
            from: new Date('2026-03-01T12:00:00Z'),
            to: new Date('2026-03-31T12:00:00Z'),
        });

        expect(rows.map((row) => row.id)).toEqual([first, last]);
        expect(rows[0]?.expenseType.id).toBe(fx.typeId);
    });
});
