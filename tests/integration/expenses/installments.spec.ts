import request from 'supertest';

import { container } from '../../../src/container';
import { EXPENSE_CREATED, type ExpenseCreated } from '../../../src/events';
import {
    DomainEventDispatcherSymbol,
    addMonths,
    businessToday,
    type DomainEventDispatcher,
} from '../../../src/platform';
import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_expenses_installments';
const ADMIN = 'Bearer uid-admin';

type Row = {
    amountCents: number;
    occurredOn: string;
    postedOn: string | null;
    status: string;
    installment: { groupId: string; number: number; total: number };
};

describe('POST /expenses com INSTALLMENT (spec 0012, parcelamento)', () => {
    let ctx: TestApp;
    let accountId: string;
    let cardId: string;
    let typeId: string;

    const send = (path: string, body: Record<string, unknown>) =>
        request(ctx.app).post(path).set('Authorization', ADMIN).send(body);

    const create = (overrides: Record<string, unknown> = {}) =>
        send('/expenses', {
            description: 'Notebook',
            expenseTypeId: typeId,
            kind: 'INSTALLMENT',
            amountCents: 10000,
            installmentTotal: 3,
            occurredOn: '2027-01-31',
            bankAccountId: accountId,
            notes: 'em 3x',
            ...overrides,
        });

    const onCard = (overrides: Record<string, unknown> = {}) =>
        create({ bankAccountId: undefined, creditCardId: cardId, ...overrides });

    const limit = async (): Promise<number> => {
        const { body } = await request(ctx.app)
            .get(`/credit-cards/${cardId}`)
            .set('Authorization', ADMIN);

        return body.data.availableLimitCents as number;
    };

    const count = async (): Promise<number> => {
        const [row] = (await ctx.dataSource.query('SELECT count(*)::int AS n FROM expenses')) as [
            { n: number },
        ];

        return row.n;
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

        const bankId = (await send('/banks', { febrabanCode: '260', name: 'Nu Pagamentos' })).body
            .data.id as string;
        accountId = (
            await send('/bank-accounts', {
                bankId,
                type: 'CHECKING',
                accountNumber: '1-1',
                description: 'Conta',
                openingBalanceCents: 100000,
            })
        ).body.data.id as string;
        cardId = (
            await send('/credit-cards', {
                bankId,
                name: 'Platinum',
                creditLimitCents: 50000,
                closingDay: 28,
                dueDay: 5,
            })
        ).body.data.id as string;
        typeId = (await send('/expense-types', { name: 'T-Casa' })).body.data.id as string;
    });

    afterEach(async () => {
        await ctx.dataSource.query('DROP TRIGGER IF EXISTS fail_second ON expenses');
        await ctx.dataSource.query('DELETE FROM expenses');
        await ctx.dataSource.query("DELETE FROM expense_types WHERE name LIKE 'T-%'");
        await ctx.dataSource.query('DELETE FROM credit_cards');
        await ctx.dataSource.query('DELETE FROM bank_accounts');
        await ctx.dataSource.query('DELETE FROM banks');
    });

    it('AC-0012-07, INV-0012-06: cria 3 linhas rateadas, mesmo grupo, e o cartão abate o total', async () => {
        const res = await onCard({ occurredOn: businessToday() });
        const rows = res.body.data as Row[];

        expect(res.status).toBe(201);
        expect(rows.map((e) => e.amountCents)).toEqual([3334, 3333, 3333]);
        expect(rows.map((e) => e.installment.number)).toEqual([1, 2, 3]);
        expect(new Set(rows.map((e) => e.installment.groupId)).size).toBe(1);
        expect(rows[0]).toMatchObject({
            kind: 'INSTALLMENT',
            status: 'OPEN',
            description: 'Notebook',
            notes: 'em 3x',
            installment: { total: 3 },
        });
        expect(await limit()).toBe(40000);
    });

    it('AC-0012-08: 31/01 em 3x ocorre em 31/01, 28/02 e 31/03 (conta)', async () => {
        const res = await create({ occurredOn: '2027-01-31' });
        const rows = res.body.data as Row[];

        expect(res.status).toBe(201);
        expect(rows.map((e) => e.occurredOn)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
        expect(rows.every((e) => e.postedOn === null)).toBe(true);
    });

    it('AC-0012-08: bissexto e 30/01 preservam o dia original', async () => {
        const leap = await create({ occurredOn: '2028-01-31' });
        const thirty = await create({ occurredOn: '2027-01-30' });

        expect((leap.body.data as Row[]).map((e) => e.occurredOn)).toEqual([
            '2028-01-31',
            '2028-02-29',
            '2028-03-31',
        ]);
        expect((thirty.body.data as Row[]).map((e) => e.occurredOn)).toEqual([
            '2027-01-30',
            '2027-02-28',
            '2027-03-30',
        ]);
    });

    it('postedOn da parcela k é o da primeira mais k-1 meses, no cartão', async () => {
        const today = businessToday();
        const res = await onCard({ occurredOn: today });
        const rows = res.body.data as Row[];
        const first = rows[0]!.postedOn as string;

        expect(res.status).toBe(201);
        expect(first >= today).toBe(true);
        expect(rows.map((e) => e.postedOn)).toEqual([
            first,
            addMonths(first, 1),
            addMonths(first, 2),
        ]);
    });

    it('janela fechada: postedOn explícito na janela fechada é 409 STATEMENT_CLOSED e nada muda', async () => {
        const res = await onCard({ occurredOn: '2020-01-31', postedOn: '2020-01-31' });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('STATEMENT_CLOSED');
        expect(await count()).toBe(0);
        expect(await limit()).toBe(50000);
    });

    it('janela fechada: compra antiga sem postedOn cai na fatura aberta e as demais seguem', async () => {
        const res = await onCard({ occurredOn: '2020-01-31' });
        const rows = res.body.data as Row[];
        const first = rows[0]!.postedOn as string;

        expect(res.status).toBe(201);
        expect(first > '2020-01-31').toBe(true);
        expect(rows[2]!.postedOn).toBe(addMonths(first, 2));
        expect(rows[0]!.occurredOn).toBe('2020-01-31');
    });

    it('FORECAST nasce em todas as parcelas e não consome limite', async () => {
        const res = await onCard({ occurredOn: businessToday(), status: 'FORECAST' });

        expect(res.status).toBe(201);
        expect((res.body.data as Row[]).every((e) => e.status === 'FORECAST')).toBe(true);
        expect(await limit()).toBe(50000);
    });

    it('conta: não move o limite de cartão algum', async () => {
        const res = await create();

        expect(res.status).toBe(201);
        expect(await limit()).toBe(50000);
    });

    it('AC-0012-09, INV-0012-06: se uma parcela falha, nenhuma existe e o limite não é tocado', async () => {
        await ctx.dataSource.query(`
            CREATE OR REPLACE FUNCTION fail_second_fn() RETURNS trigger AS $$
            BEGIN
                IF NEW.installment_number = 2 THEN RAISE EXCEPTION 'boom'; END IF;
                RETURN NEW;
            END $$ LANGUAGE plpgsql`);
        await ctx.dataSource.query(
            'CREATE TRIGGER fail_second BEFORE INSERT ON expenses FOR EACH ROW EXECUTE FUNCTION fail_second_fn()',
        );

        const res = await onCard({ occurredOn: businessToday() });

        expect(res.status).toBeGreaterThanOrEqual(500);
        expect(await count()).toBe(0);
        expect(await limit()).toBe(50000);
    });

    it('AC-0012-19: publica um ExpenseCreated por parcela, com o mesmo installmentGroupId', async () => {
        const received: ExpenseCreated[] = [];
        const unsubscribe = container
            .resolve<DomainEventDispatcher>(DomainEventDispatcherSymbol)
            .subscribe<ExpenseCreated>(EXPENSE_CREATED, async (event) => {
                received.push(event);
            });

        try {
            const res = await create();
            const rows = res.body.data as Row[];

            expect(res.status).toBe(201);
            expect(received).toHaveLength(3);
            expect(new Set(received.map((e) => e.payload.installmentGroupId)).size).toBe(1);
            expect(received[0]?.payload.installmentGroupId).toBe(rows[0]!.installment.groupId);
            expect(received.map((e) => e.payload.amountCents)).toEqual([3334, 3333, 3333]);
        } finally {
            unsubscribe();
        }
    });

    describe('ERR-0012-07: installmentTotal', () => {
        it.each([undefined, 1, 121, 2.5])(
            'recusa INSTALLMENT com installmentTotal %p citando o campo',
            async (installmentTotal) => {
                const res = await create({ installmentTotal });

                expect(res.status).toBe(400);
                expect(res.body.error.code).toBe('VALIDATION_ERROR');
                expect(JSON.stringify(res.body)).toContain('installmentTotal');
            },
        );

        it.each([2, 120])('aceita installmentTotal %p', async (installmentTotal) => {
            const res = await create({ installmentTotal, amountCents: 100000 });

            expect(res.status).toBe(201);
            expect(res.body.data).toHaveLength(installmentTotal);
        });

        it('recusa installmentTotal em VARIABLE', async () => {
            const res = await create({ kind: 'VARIABLE' });

            expect(res.status).toBe(400);
            expect(JSON.stringify(res.body)).toContain('installmentTotal');
        });
    });
});
