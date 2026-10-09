import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { container } from '../../../src/container';
import { StatementPeriodGuardSymbol, type StatementPeriodGuard } from '../../../src/expenses';
import { StatementService } from '../../../src/statements';
import { startApp, stopApp, type TestApp } from '../app.helper';
import {
    ADMIN,
    cleanFixture,
    insertExpense,
    seedFixture,
    type Fixture,
} from '../expenses/fixture.helper';

const SCHEMA = 'test_statements_closed_window';

/** "Today" is 2026-03-20: the card (closing day 10) has the cycle ending 2026-03-10 closed. */
const NOW = new Date('2026-03-20T15:00:00.000Z');
const CLOSED_THROUGH = '2026-03-10';

describe('janela fechada (spec 0013, A janela fechada)', () => {
    let ctx: TestApp;
    let fx: Fixture;

    const post = (body: Record<string, unknown>) =>
        request(ctx.app)
            .post('/expenses')
            .set('Authorization', ADMIN)
            .send({
                description: 'Compra',
                expenseTypeId: fx.typeId,
                kind: 'VARIABLE',
                amountCents: 1000,
                occurredOn: '2026-03-05',
                creditCardId: fx.cardId,
                ...body,
            });

    const patch = (id: string, body: Record<string, unknown>) =>
        request(ctx.app).patch(`/expenses/${id}`).set('Authorization', ADMIN).send(body);

    const patchStatus = (id: string, body: Record<string, unknown>) =>
        request(ctx.app).patch(`/expenses/${id}/status`).set('Authorization', ADMIN).send(body);

    const remove = (id: string) =>
        request(ctx.app).delete(`/expenses/${id}`).set('Authorization', ADMIN);

    const expectClosed = (res: request.Response): void => {
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('STATEMENT_CLOSED');
        expect(res.body.error.message).toContain(CLOSED_THROUGH);
    };

    const exists = async (id: string): Promise<boolean> =>
        ((await ctx.dataSource.query('SELECT 1 FROM expenses WHERE id = $1', [id])) as unknown[])
            .length === 1;

    const availableLimit = async (): Promise<number> =>
        Math.round(
            Number(
                (
                    (await ctx.dataSource.query(
                        'SELECT available_limit_cents AS v FROM credit_cards',
                    )) as [{ v: string }]
                )[0].v,
            ) * 100,
        );

    /** A card expense already inside the closed window (posted 2026-03-05). */
    const closedRow = (overrides: Record<string, unknown> = {}): Promise<string> =>
        insertExpense(ctx, {
            typeId: fx.typeId,
            cardId: fx.cardId,
            occurredOn: '2026-03-05',
            ...overrides,
        });

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        fx = await seedFixture(ctx);

        await ctx.dataSource.query(
            "UPDATE credit_cards SET closing_day = 10, due_day = 20, created_at = '2026-01-15T12:00:00Z'",
        );

        // Only `Date` is faked: sockets, timers and the event loop stay real.
        jest.useFakeTimers({
            now: NOW,
            doNotFake: [
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
            ],
        });
    });

    afterAll(async () => {
        jest.useRealTimers();
        await cleanFixture(ctx);
        await stopApp(ctx, SCHEMA);
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM expenses');
        await ctx.dataSource.query('DELETE FROM credit_card_statements');
        await ctx.dataSource.query('UPDATE credit_cards SET available_limit_cents = 500');
    });

    it('AC-0013-07: sem postedOn a despesa antiga nasce no primeiro dia da fatura aberta', async () => {
        const res = await post({});

        expect(res.status).toBe(201);
        expect(res.body.data[0]).toMatchObject({
            occurredOn: '2026-03-05',
            postedOn: '2026-03-11',
        });
    });

    it('AC-0013-07, ERR-0013-08: com postedOn informado na janela fechada recebe 409 STATEMENT_CLOSED', async () => {
        const res = await post({ postedOn: '2026-03-05' });

        expectClosed(res);
        expect(((await ctx.dataSource.query('SELECT 1 FROM expenses')) as unknown[]).length).toBe(
            0,
        );
    });

    it('AC-0013-07: o default de uma compra recente é o occurredOn; o dia 10 está fechado e o dia 11 aberto', async () => {
        const recent = await post({ occurredOn: '2026-03-18' });
        const lastClosedDay = await post({ occurredOn: '2026-03-10', postedOn: '2026-03-10' });
        const firstOpenDay = await post({ occurredOn: '2026-03-10', postedOn: '2026-03-11' });

        expect(recent.body.data[0].postedOn).toBe('2026-03-18');
        expectClosed(lastClosedDay);
        expect(firstOpenDay.status).toBe(201);
    });

    it('INV-0013-08: o último dia fechado vale antes e depois de closeDue registrar a fatura', async () => {
        const guard = container.resolve<StatementPeriodGuard>(StatementPeriodGuardSymbol);
        const read = async (): Promise<string> =>
            (await ctx.dataSource.transaction((manager) => guard.closedThrough(manager, fx.cardId)))
                .toISOString()
                .slice(0, 10);

        expect(await read()).toBe(CLOSED_THROUGH);

        const registered = await container.resolve(StatementService).closeDue(NOW, fx.cardId);

        expect(registered).toBe(2);
        expect(await read()).toBe(CLOSED_THROUGH);
    });

    it('INV-0013-05, AC-0013-10: na janela fechada, alterar valor ou datas recebe 409 STATEMENT_CLOSED', async () => {
        const id = await closedRow();

        expectClosed(await patch(id, { amountCents: 2000 }));
        expectClosed(await patch(id, { occurredOn: '2026-03-04' }));
        expectClosed(await patch(id, { postedOn: '2026-03-12' }));
        expect(
            (
                (await ctx.dataSource.query('SELECT amount_cents AS v FROM expenses')) as [
                    { v: string },
                ]
            )[0].v,
        ).toBe('100.00');
    });

    it('AC-0013-10: confirmar FORECAST e excluir despesa OPEN ou estorno da janela fechada recebe 409', async () => {
        const forecast = await closedRow({ status: 'FORECAST' });
        const open = await closedRow({ status: 'OPEN' });
        const verifying = await closedRow({ status: 'VERIFYING' });

        expectClosed(await patchStatus(forecast, { status: 'OPEN' }));
        expectClosed(await remove(open));
        expectClosed(await remove(verifying));
        expect(await exists(open)).toBe(true);
    });

    it('AC-0013-10: description, OPEN ↔ VERIFYING e excluir FORECAST são aceitos na janela fechada', async () => {
        const id = await closedRow({ status: 'OPEN' });
        const forecast = await closedRow({ status: 'FORECAST' });

        const renamed = await patch(id, { description: 'Corrigida', amountCents: 10000 });
        const verifying = await patchStatus(id, { status: 'VERIFYING' });
        const open = await patchStatus(id, { status: 'OPEN' });
        const removed = await remove(forecast);

        expect(renamed.status).toBe(200);
        expect(renamed.body.data.description).toBe('Corrigida');
        expect(verifying.status).toBe(200);
        expect(open.status).toBe(200);
        expect(removed.status).toBe(204);
        expect(await exists(forecast)).toBe(false);
    });

    it('AC-0013-10, INV-0013-05: mover o postedOn de uma despesa aberta para a janela fechada recebe 409', async () => {
        const id = await closedRow({ occurredOn: '2026-03-01' });

        await ctx.dataSource.query("UPDATE expenses SET posted_on = '2026-03-15' WHERE id = $1", [
            id,
        ]);

        expectClosed(await patch(id, { postedOn: '2026-03-05' }));
        expect((await patch(id, { postedOn: '2026-03-16' })).status).toBe(200);
    });

    it('AC-0013-11: parcelamento 3x com a parcela 1 em janela fechada: excluir a 2 exclui 2 e 3 e mantém a 1', async () => {
        const group = randomUUID();
        const ids: string[] = [];

        for (const [number, occurredOn] of [
            [1, '2026-03-05'],
            [2, '2026-04-05'],
            [3, '2026-05-05'],
        ] as const) {
            ids.push(
                await insertExpense(ctx, {
                    typeId: fx.typeId,
                    cardId: fx.cardId,
                    occurredOn,
                    amountCents: 10000,
                    group: { id: group, number, total: 3 },
                }),
            );
        }

        // The three installments hold 300.00 of the limit; start with 200.00 still free.
        await ctx.dataSource.query('UPDATE credit_cards SET available_limit_cents = 200');

        const res = await remove(ids[1]!);

        expect(res.status).toBe(204);
        expect(await exists(ids[0]!)).toBe(true);
        expect(await exists(ids[1]!)).toBe(false);
        expect(await exists(ids[2]!)).toBe(false);
        // Only the two removed installments gave the limit back.
        expect(await availableLimit()).toBe(40000);
    });

    it('AC-0013-11: excluir a própria parcela da janela fechada recebe 409 e o grupo fica intacto', async () => {
        const group = randomUUID();
        const ids: string[] = [];

        for (const [number, occurredOn] of [
            [1, '2026-03-05'],
            [2, '2026-04-05'],
        ] as const) {
            ids.push(
                await insertExpense(ctx, {
                    typeId: fx.typeId,
                    cardId: fx.cardId,
                    occurredOn,
                    group: { id: group, number, total: 2 },
                }),
            );
        }

        expectClosed(await remove(ids[0]!));
        expect(await exists(ids[1]!)).toBe(true);
    });

    it('AC-0013-21: PAID → OPEN numa despesa de cartão quitada pela fatura recebe 409 CREDIT_CARD_EXPENSE_PAID_BY_STATEMENT', async () => {
        const id = await closedRow({ status: 'PAID' });

        const res = await patchStatus(id, { status: 'OPEN' });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('CREDIT_CARD_EXPENSE_PAID_BY_STATEMENT');
    });
});
