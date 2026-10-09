import request from 'supertest';

import { container } from '../../../src/container';
import { EXPENSE_CREATED, type ExpenseCreated } from '../../../src/events';
import {
    ExpenseRecurrenceServiceSymbol,
    type ExpenseRecurrenceService,
} from '../../../src/expenses';
import { DomainEventDispatcherSymbol, type DomainEventDispatcher } from '../../../src/platform';
import { startApp, stopApp, type TestApp } from '../app.helper';
import { ADMIN, cleanFixture, seedFixture, type Fixture } from './fixture.helper';

const SCHEMA = 'test_expenses_recurrence_generation';

/** Só `Date` é falsificado: o driver do Postgres precisa dos timers reais. */
const FAKE_ONLY_DATE = [
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

type Row = { id: string; occurredOn: string; status: string; postedOn: string | null };

describe('série de despesas: criação e extensão (spec 0017)', () => {
    let ctx: TestApp;
    let fixture: Fixture;
    let service: ExpenseRecurrenceService;
    let received: ExpenseCreated[];
    let unsubscribe: () => void;

    const atDate = async <T>(iso: string, run: () => Promise<T>): Promise<T> => {
        jest.useFakeTimers({
            now: new Date(`${iso}T15:00:00.000Z`),
            doNotFake: [...FAKE_ONLY_DATE],
        });

        try {
            return await run();
        } finally {
            jest.useRealTimers();
        }
    };

    const createAt = (
        today: string,
        overrides: Record<string, unknown> = {},
    ): Promise<request.Response> =>
        atDate(today, () =>
            request(ctx.app)
                .post('/expenses')
                .set('Authorization', ADMIN)
                .send({
                    description: 'Aluguel',
                    expenseTypeId: fixture.typeId,
                    kind: 'FIXED',
                    amountCents: 150000,
                    occurredOn: today,
                    bankAccountId: fixture.accountId,
                    ...overrides,
                }),
        );

    const extendAt = (iso: string): Promise<number> =>
        atDate(iso, () => service.extend(new Date(`${iso}T15:00:00Z`)));

    const count = async (sql: string): Promise<number> =>
        ((await ctx.dataSource.query(sql)) as [{ n: number }])[0].n;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        service = container.resolve<ExpenseRecurrenceService>(ExpenseRecurrenceServiceSymbol);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        fixture = await seedFixture(ctx);
        await ctx.dataSource.query(
            "UPDATE credit_cards SET created_at = '2026-01-15T12:00:00Z' WHERE id = $1",
            [fixture.cardId],
        );
        received = [];
        unsubscribe = container
            .resolve<DomainEventDispatcher>(DomainEventDispatcherSymbol)
            .subscribe<ExpenseCreated>(EXPENSE_CREATED, (event) => {
                received.push(event);
            });
    });

    afterEach(async () => {
        unsubscribe();
        await ctx.dataSource.query('DELETE FROM expenses');
        await ctx.dataSource.query('DELETE FROM expense_recurrences');
        await cleanFixture(ctx);
    });

    it('AC-0017-06: criar em 10/03 cria a série e 13 ocorrências, a primeira com o status informado', async () => {
        const res = await createAt('2026-03-10');
        const rows = res.body.data as Row[];

        expect(res.status).toBe(201);
        expect(rows).toHaveLength(13);
        expect(rows[0]).toMatchObject({ occurredOn: '2026-03-10', status: 'OPEN' });
        expect(rows[1]?.occurredOn).toBe('2026-04-10');
        expect(rows[12]?.occurredOn).toBe('2027-03-10');
        expect(rows.slice(1).every((row) => row.status === 'FORECAST')).toBe(true);
        expect(received).toHaveLength(13);

        const [series] = (await ctx.dataSource.query(
            'SELECT day_of_month, starts_on::text, ends_on FROM expense_recurrences',
        )) as [{ day_of_month: number; starts_on: string; ends_on: string | null }];

        expect(series).toMatchObject({ day_of_month: 10, starts_on: '2026-03-10', ends_on: null });
        expect(await count('SELECT count(*)::int AS n FROM expense_recurrences')).toBe(1);
        expect(await count('SELECT count(DISTINCT recurrence_id)::int AS n FROM expenses')).toBe(1);
    });

    it('AC-0017-06: com occurredOn 31/01, a de fevereiro cai no último dia do mês', async () => {
        const res = await createAt('2026-01-31');
        const rows = res.body.data as Row[];

        expect(rows[1]?.occurredOn).toBe('2026-02-28');
        expect(rows[2]?.occurredOn).toBe('2026-03-31');
    });

    it('recurrenceEndsOn limita a série', async () => {
        const res = await createAt('2026-03-10', { recurrenceEndsOn: '2026-06-10' });

        expect((res.body.data as Row[]).map((row) => row.occurredOn)).toEqual([
            '2026-03-10',
            '2026-04-10',
            '2026-05-10',
            '2026-06-10',
        ]);
    });

    it('cartão: só a primeira consome limite e o postedOn segue o default da janela', async () => {
        const res = await createAt('2026-03-10', {
            bankAccountId: undefined,
            creditCardId: fixture.cardId,
            amountCents: 10000,
        });
        const rows = res.body.data as Row[];
        const card = await request(ctx.app)
            .get(`/credit-cards/${fixture.cardId}`)
            .set('Authorization', ADMIN);

        expect(res.status).toBe(201);
        expect(card.body.data.availableLimitCents).toBe(40000);
        expect(rows.every((row) => row.postedOn !== null && row.postedOn >= row.occurredOn)).toBe(
            true,
        );
        expect(rows[1]?.postedOn).toBe('2026-04-10');
    });

    it('ERR-0017-01: recurrenceEndsOn em não FIXED, ou antes de occurredOn, é 400 citando o campo', async () => {
        const notFixed = await createAt('2026-03-10', {
            kind: 'VARIABLE',
            recurrenceEndsOn: '2026-06-10',
        });
        const before = await createAt('2026-03-10', { recurrenceEndsOn: '2026-03-09' });

        for (const res of [notFixed, before]) {
            expect(res.status).toBe(400);
            expect(JSON.stringify(res.body)).toContain('recurrenceEndsOn');
        }

        expect(await count('SELECT count(*)::int AS n FROM expenses')).toBe(0);
    });

    it('AC-0017-07, INV-0017-04: extend um mês depois cria só o novo mês e é idempotente', async () => {
        await createAt('2026-03-10');
        received.length = 0;

        expect(await extendAt('2026-04-10')).toBe(1);
        expect(received).toHaveLength(1);
        expect(received[0]?.payload).toMatchObject({
            occurredOn: '2027-04-10',
            status: 'FORECAST',
        });
        expect(await extendAt('2026-04-10')).toBe(0);
        expect(await count('SELECT count(*)::int AS n FROM expenses')).toBe(14);
    });

    it('AC-0017-07: série com ends_on passado não ganha ocorrência', async () => {
        await createAt('2026-03-10', { recurrenceEndsOn: '2026-05-10' });

        expect(await extendAt('2026-06-10')).toBe(0);
        expect(await count('SELECT count(*)::int AS n FROM expenses')).toBe(3);
    });

    it('extend copia o modelo atual e um mês já ocupado nunca recebe outra ocorrência', async () => {
        const res = await createAt('2026-03-10');
        const last = (res.body.data as Row[])[12] as Row;

        await ctx.dataSource.query('UPDATE expense_recurrences SET amount_cents = 2');
        await ctx.dataSource.query("UPDATE expenses SET occurred_on = '2027-04-10' WHERE id = $1", [
            last.id,
        ]);

        // março/2027 ficou vago e é recriado com o modelo; abril/2027 já está ocupado.
        expect(await extendAt('2026-04-10')).toBe(1);
        expect(
            await count(
                "SELECT count(*)::int AS n FROM expenses WHERE occurred_on = '2027-03-10' AND amount_cents = 2",
            ),
        ).toBe(1);
        expect(
            await count("SELECT count(*)::int AS n FROM expenses WHERE occurred_on = '2027-04-10'"),
        ).toBe(1);
    });

    it('extend em série de cartão usa o postedOn default da janela fechada', async () => {
        await createAt('2026-03-10', {
            bankAccountId: undefined,
            creditCardId: fixture.cardId,
            amountCents: 10000,
        });
        await extendAt('2026-04-10');

        const [row] = (await ctx.dataSource.query(
            "SELECT posted_on::text AS posted FROM expenses WHERE occurred_on = '2027-04-10'",
        )) as [{ posted: string }];

        expect(row.posted).toBe('2027-04-10');
    });

    it('INV-0017-04: o banco recusa duas ocorrências na mesma data da série e FIXED sem série', async () => {
        await createAt('2026-03-10');

        const insert = (recurrence: string | null, date: string) =>
            ctx.dataSource.query(
                `INSERT INTO expenses (description, expense_type_id, kind, status, amount_cents,
                    occurred_on, bank_account_id, recurrence_id)
                 VALUES ('x', $1, 'FIXED', 'FORECAST', 1, $2::date, $3, $4)`,
                [fixture.typeId, date, fixture.accountId, recurrence],
            );
        const [{ id }] = (await ctx.dataSource.query('SELECT id FROM expense_recurrences')) as [
            { id: string },
        ];

        await expect(insert(id, '2026-04-10')).rejects.toThrow(
            /uq_expenses_recurrence_id_occurred_on/,
        );
        await expect(insert(null, '2026-04-11')).rejects.toThrow(/ck_expenses_recurrence/);
    });
});
