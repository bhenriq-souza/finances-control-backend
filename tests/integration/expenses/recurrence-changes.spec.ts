import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../app.helper';
import { ADMIN, cleanFixture, insertExpense, seedFixture, type Fixture } from './fixture.helper';

const SCHEMA = 'test_expenses_recurrence_changes';
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

type Row = { d: string; status: string; amount: number; description: string; card: string | null };

describe('série de despesas: alteração e encerramento (spec 0017, AC-0017-09 a AC-0017-11)', () => {
    let ctx: TestApp;
    let fixture: Fixture;

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

    /** Série criada em 10/03 (13 ocorrências, 10/03/2026 a 10/03/2027); a primeira fica OPEN. */
    const createFixed = async (overrides: Record<string, unknown> = {}): Promise<string> => {
        const res = await atDate('2026-03-10', () =>
            request(ctx.app)
                .post('/expenses')
                .set('Authorization', ADMIN)
                .send({
                    description: 'Aluguel',
                    expenseTypeId: fixture.typeId,
                    kind: 'FIXED',
                    amountCents: 150000,
                    occurredOn: '2026-03-10',
                    bankAccountId: fixture.accountId,
                    ...overrides,
                }),
        );

        expect(res.status).toBe(201);

        return (res.body.data as { recurrenceId: string }[])[0]?.recurrenceId as string;
    };

    const rows = async (): Promise<Record<string, Row>> =>
        Object.fromEntries(
            (
                (await ctx.dataSource.query(
                    `SELECT occurred_on::text AS d, status, amount_cents::float * 100 AS amount,
                            description, credit_card_id AS card
                       FROM expenses ORDER BY occurred_on`,
                )) as Row[]
            ).map((row) => [row.d, row]),
        );

    const idOf = async (date: string): Promise<string> =>
        (
            (await ctx.dataSource.query('SELECT id FROM expenses WHERE occurred_on = $1::date', [
                date,
            ])) as { id: string }[]
        )[0]?.id as string;

    const setStatus = async (date: string, status: string): Promise<void> => {
        await ctx.dataSource.query(
            'UPDATE expenses SET status = $2, paid_on = $3 WHERE occurred_on = $1::date',
            [date, status, status === 'PAID' ? date : null],
        );
    };

    const series = async (): Promise<{ ends_on: string | null; amount: number } | undefined> =>
        (
            (await ctx.dataSource.query(
                'SELECT ends_on::text, amount_cents::float * 100 AS amount FROM expense_recurrences',
            )) as { ends_on: string | null; amount: number }[]
        )[0];

    const patchFollowing = (id: string, body: Record<string, unknown>, clock = '2026-03-10') =>
        atDate(clock, () =>
            request(ctx.app)
                .patch(`/expenses/${id}?scope=following`)
                .set('Authorization', ADMIN)
                .send(body),
        );

    const limit = async (): Promise<number> =>
        (await request(ctx.app).get(`/credit-cards/${fixture.cardId}`).set('Authorization', ADMIN))
            .body.data.availableLimitCents as number;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
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
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM expenses');
        await ctx.dataSource.query('DELETE FROM expense_recurrences');
        await cleanFixture(ctx);
    });

    describe('PATCH /expenses/:id?scope=following', () => {
        it('AC-0017-09, INV-0017-07: muda o modelo, a ocorrência e as FORECAST seguintes; nada mais', async () => {
            await createFixed();
            await setStatus('2026-04-10', 'PAID');
            await setStatus('2026-05-10', 'OVERDUE');
            await setStatus('2026-07-10', 'OPEN');
            await setStatus('2026-08-10', 'PAID');

            const res = await patchFollowing(await idOf('2026-06-10'), {
                amountCents: 165000,
                description: 'Aluguel reajustado',
                notes: 'reajuste',
            });

            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({ amountCents: 165000, occurredOn: '2026-06-10' });
            expect(res.body.data.recurrenceId).toEqual(expect.any(String));

            const state = await rows();

            for (const date of ['2026-06-10', '2026-09-10', '2027-03-10']) {
                expect(state[date]).toMatchObject({
                    amount: 165000,
                    description: 'Aluguel reajustado',
                });
            }

            // Anteriores, promovida e paga antecipadamente não mudam.
            for (const date of [
                '2026-03-10',
                '2026-04-10',
                '2026-05-10',
                '2026-07-10',
                '2026-08-10',
            ]) {
                expect(state[date]).toMatchObject({ amount: 150000, description: 'Aluguel' });
            }

            expect(await series()).toMatchObject({ amount: 165000 });
            expect(
                (
                    (await ctx.dataSource.query(
                        'SELECT description, notes, expense_type_id FROM expense_recurrences',
                    )) as { description: string; notes: string }[]
                )[0],
            ).toMatchObject({ description: 'Aluguel reajustado', notes: 'reajuste' });
        });

        it('sem scope altera só a ocorrência e deixa o modelo (comportamento anterior)', async () => {
            await createFixed();

            const res = await request(ctx.app)
                .patch(`/expenses/${await idOf('2026-06-10')}`)
                .set('Authorization', ADMIN)
                .send({ amountCents: 165000 });

            expect(res.status).toBe(200);
            expect((await rows())['2026-07-10']?.amount).toBe(150000);
            expect(await series()).toMatchObject({ amount: 150000 });
        });

        it('ERR-0017-02: scope=following em lançamento sem série é 400 citando scope', async () => {
            const id = await insertExpense(ctx, {
                typeId: fixture.typeId,
                accountId: fixture.accountId,
            });
            const res = await patchFollowing(id, { amountCents: 2000 });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(JSON.stringify(res.body.error)).toContain('scope');

            expect(
                (
                    await request(ctx.app)
                        .patch(`/expenses/${id}?scope=all`)
                        .set('Authorization', ADMIN)
                        .send({ amountCents: 2000 })
                ).status,
            ).toBe(400);
        });

        it('expense inexistente com scope é 404', async () => {
            const res = await patchFollowing(randomUUID(), { amountCents: 2000 });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('EXPENSE_NOT_FOUND');
        });
    });

    describe('PATCH /expenses/:id/payment-method?scope=following', () => {
        const moveFollowing = (id: string, body: Record<string, unknown>) =>
            atDate('2026-03-10', () =>
                request(ctx.app)
                    .patch(`/expenses/${id}/payment-method?scope=following`)
                    .set('Authorization', ADMIN)
                    .send(body),
            );

        it('INV-0017-07: troca modelo e FORECAST seguintes para o cartão; anteriores e pagas ficam', async () => {
            await createFixed();
            await setStatus('2026-04-10', 'PAID');
            await setStatus('2026-07-10', 'OPEN');
            await setStatus('2026-08-10', 'PAID');

            const res = await moveFollowing(await idOf('2026-06-10'), {
                creditCardId: fixture.cardId,
            });

            expect(res.status).toBe(200);
            expect(
                (res.body.data as { occurredOn: string }[]).map((row) => row.occurredOn).sort(),
            ).toEqual(['2026-06-10', ...monthsFrom('2026-09-10', 7)]);

            const state = await rows();

            for (const date of ['2026-06-10', '2026-09-10', '2027-03-10']) {
                expect(state[date]?.card).toBe(fixture.cardId);
            }

            for (const date of ['2026-03-10', '2026-04-10', '2026-07-10', '2026-08-10']) {
                expect(state[date]?.card).toBeNull();
            }

            expect(
                (
                    (await ctx.dataSource.query(
                        'SELECT credit_card_id, bank_account_id FROM expense_recurrences',
                    )) as { credit_card_id: string | null; bank_account_id: string | null }[]
                )[0],
            ).toEqual({ credit_card_id: fixture.cardId, bank_account_id: null });
            // FORECAST não consome limite.
            expect(await limit()).toBe(50000);
        });

        it('sem scope troca só a ocorrência; ERR-0017-02 sem série', async () => {
            await createFixed();

            const only = await request(ctx.app)
                .patch(`/expenses/${await idOf('2026-06-10')}/payment-method`)
                .set('Authorization', ADMIN)
                .send({ creditCardId: fixture.cardId });

            expect(only.status).toBe(200);
            expect((await rows())['2026-07-10']?.card).toBeNull();

            const id = await insertExpense(ctx, {
                typeId: fixture.typeId,
                accountId: fixture.accountId,
            });
            const res = await moveFollowing(id, { creditCardId: fixture.cardId });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(JSON.stringify(res.body.error)).toContain('scope');
        });

        it('ocorrência já no destino não impede mover as seguintes que divergem', async () => {
            await createFixed();

            const id = await idOf('2026-06-10');

            expect(
                (
                    await request(ctx.app)
                        .patch(`/expenses/${id}/payment-method`)
                        .set('Authorization', ADMIN)
                        .send({ creditCardId: fixture.cardId })
                ).status,
            ).toBe(200);

            const res = await moveFollowing(id, { creditCardId: fixture.cardId });

            expect(res.status).toBe(200);
            expect((res.body.data as { id: string }[]).map((row) => row.id)).toContain(id);
            expect((await rows())['2026-07-10']?.card).toBe(fixture.cardId);
            expect((await rows())['2026-05-10']?.card).toBeNull();
        });
    });

    describe('DELETE /expenses/:id numa ocorrência de série', () => {
        const remove = (id: string, clock = '2026-03-10') =>
            atDate(clock, () =>
                request(ctx.app).delete(`/expenses/${id}`).set('Authorization', ADMIN),
            );

        it('AC-0017-10, INV-0017-06: exclui a ocorrência e as seguintes não pagas; ends_on = 09/06', async () => {
            await createFixed();
            await setStatus('2026-04-10', 'PAID');
            await setStatus('2026-05-10', 'OVERDUE');
            await setStatus('2026-08-10', 'PAID');

            const res = await remove(await idOf('2026-06-10'));

            expect(res.status).toBe(204);
            expect(Object.keys(await rows())).toEqual([
                '2026-03-10',
                '2026-04-10',
                '2026-05-10',
                '2026-08-10',
            ]);
            expect((await series())?.ends_on).toBe('2026-06-09');
        });

        it('devolve o limite das de cartão consumidas e mantém as de janela fechada', async () => {
            await createFixed({ bankAccountId: undefined, creditCardId: fixture.cardId });

            // Julho já está numa fatura fechada em 10/09 (janela até 28/08): fica, como se paga.
            await setStatus('2026-07-10', 'OPEN');

            // Setembro vira compromisso e consome limite (R$ 1.500 de R$ 500 de limite, sem barrar).
            const promoted = await atDate('2026-09-10', async () =>
                request(ctx.app)
                    .patch(`/expenses/${await idOf('2026-09-10')}/status`)
                    .set('Authorization', ADMIN)
                    .send({ status: 'OPEN' }),
            );

            expect(promoted.status).toBe(200);

            const before = await limit();
            const res = await remove(await idOf('2026-06-10'), '2026-09-10');

            expect(res.status).toBe(204);
            expect(await limit()).toBe(before + 150000);
            expect(Object.keys(await rows()).filter((date) => date >= '2026-06-10')).toEqual([
                '2026-07-10',
            ]);
        });

        it('a ocorrência paga não se exclui (409), e nada muda', async () => {
            await createFixed();
            await setStatus('2026-06-10', 'PAID');

            const res = await remove(await idOf('2026-06-10'));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('EXPENSE_ALREADY_PAID');
            expect(Object.keys(await rows())).toHaveLength(13);
            expect((await series())?.ends_on).toBeNull();
        });

        it('excluir a primeira sem nada que fique remove a série; com paga posterior, a série encolhe a ela', async () => {
            await createFixed();
            expect((await remove(await idOf('2026-03-10'))).status).toBe(204);
            expect(await rows()).toEqual({});
            expect(await series()).toBeUndefined();

            await createFixed();
            await setStatus('2026-08-10', 'PAID');
            expect((await remove(await idOf('2026-03-10'))).status).toBe(204);
            expect(Object.keys(await rows())).toEqual(['2026-08-10']);
            expect(
                (
                    (await ctx.dataSource.query(
                        'SELECT starts_on::text AS s, ends_on::text AS e FROM expense_recurrences',
                    )) as { s: string; e: string }[]
                )[0],
            ).toEqual({ s: '2026-08-10', e: '2026-08-10' });
        });
    });

    describe('/expense-recurrences', () => {
        const patchSeries = (id: string, body: Record<string, unknown>, auth = ADMIN) =>
            request(ctx.app)
                .patch(`/expense-recurrences/${id}`)
                .set('Authorization', auth)
                .send(body);

        it('AC-0017-11, INV-0017-06: endsOn exclui as FORECAST posteriores e mantém as demais', async () => {
            const id = await createFixed();
            await setStatus('2026-05-10', 'OPEN');
            await setStatus('2026-08-10', 'PAID');

            const res = await patchSeries(id, { endsOn: '2026-05-20' });

            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({ id, endsOn: '2026-05-20', dayOfMonth: 10 });
            expect(Object.keys(await rows())).toEqual([
                '2026-03-10',
                '2026-04-10',
                '2026-05-10',
                '2026-08-10',
            ]);
        });

        it('ERR-0017-03: campo além de endsOn, endsOn ausente ou antes de startsOn é 400 citando o campo', async () => {
            const id = await createFixed();

            const extra = await patchSeries(id, { endsOn: '2026-05-20', amountCents: 1 });

            expect(extra.status).toBe(400);
            expect(extra.body.error.code).toBe('VALIDATION_ERROR');
            expect(JSON.stringify(extra.body.error)).toContain('amountCents');

            const empty = await patchSeries(id, {});

            expect(empty.status).toBe(400);
            expect(JSON.stringify(empty.body.error)).toContain('endsOn');

            const early = await patchSeries(id, { endsOn: '2026-03-09' });

            expect(early.status).toBe(400);
            expect(early.body.error.code).toBe('VALIDATION_ERROR');
            expect(JSON.stringify(early.body.error)).toContain('endsOn');
            expect(Object.keys(await rows())).toHaveLength(13);
        });

        it('ERR-0017-04: série inexistente é 404 EXPENSE_RECURRENCE_NOT_FOUND', async () => {
            const missing = randomUUID();

            for (const res of [
                await request(ctx.app)
                    .get(`/expense-recurrences/${missing}`)
                    .set('Authorization', ADMIN),
                await patchSeries(missing, { endsOn: '2026-05-20' }),
            ]) {
                expect(res.status).toBe(404);
                expect(res.body.error.code).toBe('EXPENSE_RECURRENCE_NOT_FOUND');
            }
        });

        it('GET devolve a série com nextOccurrenceOn; active=true tira as encerradas', async () => {
            const open = await createFixed();
            const ended = await createFixed({ description: 'Internet' });

            await patchSeries(ended, { endsOn: '2026-05-20' });

            const get = await atDate('2026-04-12', () =>
                request(ctx.app).get(`/expense-recurrences/${open}`).set('Authorization', ADMIN),
            );

            expect(get.status).toBe(200);
            expect(get.body.data).toEqual({
                id: open,
                description: 'Aluguel',
                typeId: fixture.typeId,
                amountCents: 150000,
                dayOfMonth: 10,
                bankAccountId: fixture.accountId,
                creditCardId: null,
                startsOn: '2026-03-10',
                endsOn: null,
                nextOccurrenceOn: '2026-05-10',
                createdAt: expect.any(String),
                updatedAt: expect.any(String),
            });

            const all = await atDate('2026-08-01', () =>
                request(ctx.app).get('/expense-recurrences').set('Authorization', ADMIN),
            );
            const active = await atDate('2026-08-01', () =>
                request(ctx.app)
                    .get('/expense-recurrences?active=true')
                    .set('Authorization', ADMIN),
            );

            expect((all.body.data as { id: string }[]).map((row) => row.id).sort()).toEqual(
                [open, ended].sort(),
            );
            expect((active.body.data as { id: string }[]).map((row) => row.id)).toEqual([open]);
            expect(
                (all.body.data as { id: string; nextOccurrenceOn: string | null }[]).find(
                    (row) => row.id === ended,
                )?.nextOccurrenceOn,
            ).toBeNull();
            expect(
                (
                    await request(ctx.app)
                        .get('/expense-recurrences?active=maybe')
                        .set('Authorization', ADMIN)
                ).status,
            ).toBe(400);
        });

        it('VIEWER lê, mas recebe 403 no PATCH da série', async () => {
            const id = await createFixed();
            const uid = 'uid-VIEWER-recurrence';

            await request(ctx.app).get('/users/me').set('Authorization', `Bearer ${uid}`);
            await ctx.setProfile(uid, 'VIEWER');

            const viewer = `Bearer ${uid}`;

            expect(
                (
                    await request(ctx.app)
                        .get(`/expense-recurrences/${id}`)
                        .set('Authorization', viewer)
                ).status,
            ).toBe(200);
            expect(
                (await request(ctx.app).get('/expense-recurrences').set('Authorization', viewer))
                    .status,
            ).toBe(200);

            const res = await patchSeries(id, { endsOn: '2026-05-20' }, viewer);

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('FORBIDDEN');
            expect(Object.keys(await rows())).toHaveLength(13);
        });
    });
});

/** `count` datas mensais a partir de `from` (dia 10, sem virada de dia). */
function monthsFrom(from: string, count: number): string[] {
    const [year, month] = from.split('-').map(Number) as [number, number];

    return Array.from({ length: count }, (_, index) => {
        const total = year * 12 + month - 1 + index;

        return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-10`;
    });
}
