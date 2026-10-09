import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { container } from '../../../src/container';
import { ExpenseServiceSymbol, ExpenseType, type ExpenseService } from '../../../src/expenses';
import { startApp, stopApp, type TestApp } from '../app.helper';
import { ADMIN, seedFixture, type Fixture } from '../expenses/fixture.helper';

const SCHEMA = 'test_statements_query';

/** 2026-04-15 in business time. With a card closing on 10 and created on 2026-01-15, the
 * statements closing on 02/10, 03/10 and 04/10 are overdue to be recorded; the open one is
 * 04/11 to 05/10. */
const NOW = new Date('2026-04-15T15:00:00.000Z');

/** Only `Date` is faked: sockets, timers and the event loop stay real. */
const FAKE_DATE_ONLY = [
    'hrtime',
    'nextTick',
    'performance',
    'queueMicrotask',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'requestIdleCallback',
    'cancelIdleCallback',
    'setImmediate',
    'clearImmediate',
    'setInterval',
    'clearInterval',
    'setTimeout',
    'clearTimeout',
] as const;

type ExpenseRow = {
    typeId: string;
    status?: string;
    cents: number;
    postedOn: string;
    group?: { id: string; number: number; total: number };
};

describe('consulta e resumo de faturas (spec 0013, T-0013-05)', () => {
    let ctx: TestApp;
    let fx: Fixture;
    let alphaId: string;
    let betaId: string;

    const at = (iso: string): Date => new Date(`${iso}T15:00:00.000Z`);

    const get = (path: string, auth: string = ADMIN) =>
        request(ctx.app).get(path).set('Authorization', auth);

    const list = (query = '') => get(`/statements?creditCardId=${fx.cardId}${query}`);

    const addExpense = async (row: ExpenseRow): Promise<string> => {
        const status = row.status ?? 'OPEN';
        const rows = (await ctx.dataSource.query(
            `INSERT INTO expenses (description, expense_type_id, kind, status, amount_cents,
                occurred_on, paid_on, credit_card_id, posted_on, installment_group_id,
                installment_number, installment_total)
             VALUES ('Compra', $1, $2, $3, $4, $5::date, $6::date, $7, $5::date, $8, $9, $10)
             RETURNING id`,
            [
                row.typeId,
                row.group ? 'INSTALLMENT' : 'VARIABLE',
                status,
                row.cents / 100,
                row.postedOn,
                status === 'PAID' ? row.postedOn : null,
                fx.cardId,
                row.group?.id ?? null,
                row.group?.number ?? null,
                row.group?.total ?? null,
            ],
        )) as { id: string }[];

        return rows[0]!.id;
    };

    const addRefund = (postedOn: string, cents: number) =>
        ctx.dataSource.query(
            `INSERT INTO credit_card_refunds (credit_card_id, description, amount_cents, occurred_on, posted_on)
             VALUES ($1, 'Estorno', $2, $3::date, $3::date)`,
            [fx.cardId, cents / 100, postedOn],
        );

    const addPayment = (cents: number, paidOn: string, statementId: string | null = null) =>
        ctx.dataSource.query(
            `INSERT INTO credit_card_statement_payments (credit_card_id, statement_id, bank_account_id, amount_cents, paid_on)
             VALUES ($1, $2, $3, $4, $5::date)`,
            [fx.cardId, statementId, fx.accountId, cents / 100, paidOn],
        );

    const statementRow = async (closesOn: string) =>
        (
            (await ctx.dataSource.query(
                'SELECT id, status FROM credit_card_statements WHERE credit_card_id = $1 AND closes_on = $2',
                [fx.cardId, closesOn],
            )) as { id: string; status: string }[]
        )[0]!;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        fx = await seedFixture(ctx);

        const types = ctx.dataSource.getRepository(ExpenseType);

        alphaId = (await types.save({ name: 'T-Alpha', archivedAt: null })).id;
        betaId = (await types.save({ name: 'T-Beta', archivedAt: null })).id;

        jest.useFakeTimers({ now: NOW, doNotFake: [...FAKE_DATE_ONLY] });
    });

    afterAll(async () => {
        jest.useRealTimers();
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        jest.setSystemTime(NOW);
        await ctx.dataSource.query(
            "UPDATE credit_cards SET closing_day = 10, due_day = 20, created_at = '2026-01-15T12:00:00Z'",
        );
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM credit_card_statement_payments');
        await ctx.dataSource.query('DELETE FROM credit_card_refunds');
        await ctx.dataSource.query('DELETE FROM credit_card_statements');
        await ctx.dataSource.query('DELETE FROM expenses');
    });

    it('AC-0013-06, INV-0013-08: sem job, a listagem já registra o fechamento e mostra as fechadas e a aberta', async () => {
        const res = await list();

        expect(res.status).toBe(200);
        expect(
            res.body.data.map((s: { closesOn: string; status: string }) => [s.closesOn, s.status]),
        ).toEqual([
            ['2026-02-10', 'PAID'],
            ['2026-03-10', 'PAID'],
            ['2026-04-10', 'PAID'],
            ['2026-05-10', 'OPEN'],
        ]);
        expect(res.body.data[0].closedAt).toBe(NOW.toISOString());
        expect(res.body.data[3]).toMatchObject({
            id: null,
            closedAt: null,
            creditCardId: fx.cardId,
        });
        expect(res.body.data[0]).not.toHaveProperty('expenses');
        expect(await ctx.dataSource.query('SELECT 1 FROM credit_card_statements')).toHaveLength(3);
    });

    it('AC-0013-09, INV-0013-02: compras 1000/500/300(FORECAST) e estorno 200 dão 1500, 200 e 1300; byExpenseType soma as compras', async () => {
        await addExpense({ typeId: fx.typeId, cents: 100000, postedOn: '2026-04-11' });
        await addExpense({
            typeId: betaId,
            status: 'VERIFYING',
            cents: 25000,
            postedOn: '2026-04-12',
        });
        await addExpense({ typeId: alphaId, status: 'PAID', cents: 25000, postedOn: '2026-04-13' });
        await addExpense({
            typeId: fx.typeId,
            status: 'FORECAST',
            cents: 30000,
            postedOn: '2026-04-14',
        });
        await addRefund('2026-04-12', 20000);

        const res = await get(`/statements/current?creditCardId=${fx.cardId}`);

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            id: null,
            status: 'OPEN',
            startsOn: '2026-04-11',
            closesOn: '2026-05-10',
            dueOn: '2026-05-20',
            purchasesCents: 150000,
            refundsCents: 20000,
            totalCents: 130000,
            previousBalanceCents: 0,
            amountDueCents: 130000,
            paidCents: 0,
            remainingCents: 130000,
            minimumPaymentCents: null,
            overdue: false,
            payments: [],
        });
        // Ordered by total, then name; FORECAST is out and the groups add up to the purchases.
        expect(res.body.data.byExpenseType).toEqual([
            { expenseTypeId: fx.typeId, name: 'T-Mercado', totalCents: 100000 },
            { expenseTypeId: alphaId, name: 'T-Alpha', totalCents: 25000 },
            { expenseTypeId: betaId, name: 'T-Beta', totalCents: 25000 },
        ]);
        expect(
            res.body.data.byExpenseType.reduce(
                (sum: number, group: { totalCents: number }) => sum + group.totalCents,
                0,
            ),
        ).toBe(res.body.data.purchasesCents);
        expect(res.body.data.expenses.map((e: { postedOn: string }) => e.postedOn)).toEqual([
            '2026-04-11',
            '2026-04-12',
            '2026-04-13',
            '2026-04-14',
        ]);
        expect(res.body.data.expenses[0]).toMatchObject({
            amountCents: 100000,
            status: 'OPEN',
            expenseType: { id: fx.typeId, name: 'T-Mercado' },
            installment: null,
        });
        expect(res.body.data.refunds).toHaveLength(1);
        expect(res.body.data.refunds[0]).toMatchObject({
            amountCents: 20000,
            postedOn: '2026-04-12',
            expenseId: null,
        });
    });

    it('INV-0013-01: o postedOn decide a fatura; 04/10 fica na que fecha em 04/10 e 04/11 na aberta, e o restante da fechada entra na aberta', async () => {
        await addExpense({ typeId: fx.typeId, cents: 40000, postedOn: '2026-04-10' });
        await addExpense({ typeId: fx.typeId, cents: 70000, postedOn: '2026-04-11' });

        const closed = await list();
        const lastClosed = closed.body.data.find(
            (s: { closesOn: string }) => s.closesOn === '2026-04-10',
        );
        const open = closed.body.data.find(
            (s: { closesOn: string }) => s.closesOn === '2026-05-10',
        );

        expect(lastClosed).toMatchObject({
            status: 'CLOSED',
            purchasesCents: 40000,
            remainingCents: 40000,
        });
        // Provisional: the last closed statement is still CLOSED, so its remainder is carried.
        expect(open).toMatchObject({
            purchasesCents: 70000,
            previousBalanceCents: 40000,
            amountDueCents: 110000,
        });

        const detail = await get(`/statements/${lastClosed.id}`);

        expect(detail.status).toBe(200);
        expect(detail.body.data.expenses).toHaveLength(1);
        expect(detail.body.data).toMatchObject({
            id: lastClosed.id,
            startsOn: '2026-03-11',
            dueOn: '2026-04-20',
        });
    });

    it('AC-0013-24 (leitura): pagamentos antecipados aparecem como pago da aberta, sem marcar despesa como paga', async () => {
        await addExpense({ typeId: fx.typeId, cents: 150000, postedOn: '2026-04-12' });
        // Records the closings first: an early payment made before them would belong to the
        // first statement recorded.
        await list();
        await addPayment(50000, '2026-04-13');

        const res = await get(`/statements/current?creditCardId=${fx.cardId}`);

        expect(res.body.data).toMatchObject({ paidCents: 50000, remainingCents: 100000 });
        expect(res.body.data.payments).toHaveLength(1);
        expect(res.body.data.payments[0]).toMatchObject({
            amountCents: 50000,
            paidOn: '2026-04-13',
        });
        expect(res.body.data.expenses[0].status).toBe('OPEN');

        const later = await list('&from=2026-06-01&to=2026-07-10');

        expect(later.body.data.map((s: { paidCents: number }) => s.paidCents)).toEqual([0, 0]);
    });

    it('AC-0013-22: um parcelamento em 3x aparece em três faturas, a corrente e duas projetadas', async () => {
        const groupId = randomUUID();

        for (const [number, postedOn] of [
            [1, '2026-04-11'],
            [2, '2026-05-11'],
            [3, '2026-06-11'],
        ] as const) {
            await addExpense({
                typeId: fx.typeId,
                cents: 10000,
                postedOn,
                group: { id: groupId, number, total: 3 },
            });
        }

        const res = await list('&from=2026-05-10&to=2026-07-10');

        expect(res.status).toBe(200);
        expect(
            res.body.data.map((s: { closesOn: string; purchasesCents: number }) => [
                s.closesOn,
                s.purchasesCents,
            ]),
        ).toEqual([
            ['2026-05-10', 10000],
            ['2026-06-10', 10000],
            ['2026-07-10', 10000],
        ]);
        expect(res.body.data.map((s: { id: string | null }) => s.id)).toEqual([null, null, null]);

        const current = await get(`/statements/current?creditCardId=${fx.cardId}`);

        expect(current.body.data.expenses[0].installment).toEqual({
            groupId,
            number: 1,
            total: 3,
        });
    });

    it('INV-0013-03, AC-0013-03: mudar o closing_day não deixa buraco nem sobreposição entre as faturas persistidas e as projetadas', async () => {
        await list();
        await ctx.dataSource.query('UPDATE credit_cards SET closing_day = 5, due_day = 3');

        const res = await list('&from=2026-02-01&to=2026-08-31');
        const rows = res.body.data as { startsOn: string; closesOn: string; dueOn: string }[];

        expect(rows.slice(0, 3).map((s) => [s.startsOn, s.closesOn, s.dueOn])).toEqual([
            ['2026-01-11', '2026-02-10', '2026-02-20'],
            ['2026-02-11', '2026-03-10', '2026-03-20'],
            ['2026-03-11', '2026-04-10', '2026-04-20'],
        ]);
        // The open one continues from 04/10 with the new configuration.
        expect(rows[3]).toMatchObject({
            startsOn: '2026-04-11',
            closesOn: '2026-05-05',
            dueOn: '2026-06-03',
        });

        for (let index = 1; index < rows.length; index += 1) {
            const previous = new Date(`${rows[index - 1]!.closesOn}T00:00:00.000Z`).getTime();
            const next = new Date(`${rows[index]!.startsOn}T00:00:00.000Z`).getTime();

            expect(next - previous).toBe(24 * 60 * 60 * 1000);
        }
    });

    it('AC-0013-17: vencida só com a fatura CLOSED, vencimento passado e pago abaixo do mínimo (ou do devido, sem mínimo)', async () => {
        await addExpense({ typeId: fx.typeId, cents: 100000, postedOn: '2026-04-20' });
        // On 05/21 the statement closed on 05/10 (due 05/20) is the last recorded one.
        jest.setSystemTime(at('2026-05-21'));

        const first = await list('&from=2026-05-10&to=2026-05-10');
        const statement = await statementRow('2026-05-10');

        expect(first.body.data[0]).toMatchObject({
            id: statement.id,
            status: 'CLOSED',
            overdue: true,
        });

        await ctx.dataSource.query(
            'UPDATE credit_card_statements SET minimum_payment_cents = 300.00 WHERE id = $1',
            [statement.id],
        );
        await addPayment(20000, '2026-05-15', statement.id);

        expect((await get(`/statements/${statement.id}`)).body.data).toMatchObject({
            minimumPaymentCents: 30000,
            paidCents: 20000,
            overdue: true,
        });

        await addPayment(10000, '2026-05-16', statement.id);

        expect((await get(`/statements/${statement.id}`)).body.data).toMatchObject({
            paidCents: 30000,
            remainingCents: 70000,
            overdue: false,
        });

        await ctx.dataSource.query(
            'UPDATE credit_card_statements SET minimum_payment_cents = NULL, status = $2 WHERE id = $1',
            [statement.id, 'PAID'],
        );

        expect((await get(`/statements/${statement.id}`)).body.data.overdue).toBe(false);
    });

    it('listByCreditCard devolve o CardExpenseSummary por postedOn, com tipo e parcela', async () => {
        const service = container.resolve<ExpenseService>(ExpenseServiceSymbol);
        const groupId = randomUUID();
        const inside = await addExpense({
            typeId: alphaId,
            cents: 12345,
            postedOn: '2026-04-20',
            group: { id: groupId, number: 2, total: 4 },
        });

        await addExpense({ typeId: alphaId, cents: 100, postedOn: '2026-05-11' });

        const rows = await service.listByCreditCard(fx.cardId, {
            from: new Date('2026-04-11T12:00:00Z'),
            to: new Date('2026-05-10T12:00:00Z'),
        });

        expect(rows).toEqual([
            {
                id: inside,
                description: 'Compra',
                occurredOn: '2026-04-20',
                postedOn: '2026-04-20',
                amountCents: 12345,
                status: 'OPEN',
                expenseType: { id: alphaId, name: 'T-Alpha' },
                installment: { groupId, number: 2, total: 4 },
            },
        ]);
    });

    it('ERR-0013-01: fatura inexistente é 404 STATEMENT_NOT_FOUND; cartão inexistente é 404 CREDIT_CARD_NOT_FOUND; id malformado é 400', async () => {
        const missing = await get(`/statements/${randomUUID()}`);
        expect([missing.status, missing.body.error.code]).toEqual([404, 'STATEMENT_NOT_FOUND']);

        for (const path of ['/statements', '/statements/current']) {
            const card = await get(`${path}?creditCardId=${randomUUID()}`);
            expect([card.status, card.body.error.code]).toEqual([404, 'CREDIT_CARD_NOT_FOUND']);
        }

        expect((await get('/statements/xyz')).status).toBe(400);
    });

    it.each([
        ['/statements', 'creditCardId'],
        ['/statements/current', 'creditCardId'],
    ])('ERR-0013-02: %s sem creditCardId recebe 400 citando o campo', async (path, field) => {
        const res = await get(path);

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(JSON.stringify(res.body.error)).toContain(field);
    });

    it.each(['from=ontem', 'to=2026-13-40', 'creditCardId=nao-uuid', 'foo=1'])(
        'filtro inválido %s recebe 400 citando o campo',
        async (query) => {
            const res = await get(`/statements?creditCardId=${fx.cardId}&${query}`);

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(JSON.stringify(res.body.error)).toContain(query.split('=')[0]);
        },
    );

    it('ERR-0013-09: from depois de to recebe 400', async () => {
        const res = await list('&from=2026-06-01&to=2026-05-01');

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('ERR-0013-10: 120 faturas na janela são aceitas e 121 recebem 400', async () => {
        const ok = await list('&from=2026-05-01&to=2036-04-30');

        expect(ok.status).toBe(200);
        expect(ok.body.data).toHaveLength(120);

        const tooMany = await list('&from=2026-05-01&to=2036-05-31');

        expect(tooMany.status).toBe(400);
        expect(tooMany.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('INV-0013-13: VIEWER lê; sem perfil recebe 403 PROFILE_PENDING; sem token, 401', async () => {
        await list();
        const statement = await statementRow('2026-04-10');
        const as = async (uid: string, profile: 'VIEWER' | null): Promise<string> => {
            await request(ctx.app).get('/users/me').set('Authorization', `Bearer ${uid}`);
            await ctx.setProfile(uid, profile);

            return `Bearer ${uid}`;
        };
        const viewer = await as('uid-viewer-q', 'VIEWER');
        const pending = await as('uid-pending-q', null);
        const paths = [
            `/statements?creditCardId=${fx.cardId}`,
            `/statements/current?creditCardId=${fx.cardId}`,
            `/statements/${statement.id}`,
        ];

        for (const path of paths) {
            expect((await get(path, viewer)).status).toBe(200);

            const denied = await get(path, pending);
            expect([denied.status, denied.body.error.code]).toEqual([403, 'PROFILE_PENDING']);
            expect((await request(ctx.app).get(path)).status).toBe(401);
        }
    });
});
