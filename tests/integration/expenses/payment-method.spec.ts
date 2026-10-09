import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../app.helper';
import { ADMIN, cleanFixture, insertExpense, seedFixture, type Fixture } from './fixture.helper';

const SCHEMA = 'test_expenses_payment_method';

/** "Today" is 2026-03-20: the card (closing day 10) has the cycle ending 2026-03-10 closed. */
const NOW = new Date('2026-03-20T15:00:00.000Z');
const CLOSED_THROUGH = '2026-03-10';
const INITIAL_LIMIT = 50000;
const VIEWER = 'Bearer uid-viewer';

describe('troca de forma de pagamento (spec 0012)', () => {
    let ctx: TestApp;
    let fx: Fixture;

    const change = (id: string, body: Record<string, unknown>, auth = ADMIN) =>
        request(ctx.app)
            .patch(`/expenses/${id}/payment-method`)
            .set('Authorization', auth)
            .send(body);

    const toCard = (id: string, extra: Record<string, unknown> = {}, auth = ADMIN) =>
        change(id, { creditCardId: fx.cardId, ...extra }, auth);

    const toAccount = (id: string) => change(id, { bankAccountId: fx.accountId });

    const onAccount = (overrides: Record<string, unknown> = {}): Promise<string> =>
        insertExpense(ctx, {
            typeId: fx.typeId,
            accountId: fx.accountId,
            occurredOn: '2026-01-15',
            amountCents: 1000,
            ...overrides,
        });

    const onCard = (overrides: Record<string, unknown> = {}): Promise<string> =>
        insertExpense(ctx, {
            typeId: fx.typeId,
            cardId: fx.cardId,
            occurredOn: '2026-03-15',
            amountCents: 1000,
            ...overrides,
        });

    const row = async (id: string) =>
        (
            (await ctx.dataSource.query(
                `SELECT status, bank_account_id AS "bankAccountId", credit_card_id AS "creditCardId",
                    to_char(posted_on, 'YYYY-MM-DD') AS "postedOn"
                 FROM expenses WHERE id = $1`,
                [id],
            )) as {
                status: string;
                bankAccountId: string | null;
                creditCardId: string | null;
                postedOn: string | null;
            }[]
        )[0]!;

    const scalar = async (sql: string): Promise<number> =>
        Math.round(Number(((await ctx.dataSource.query(sql)) as [{ v: string }])[0].v) * 100);
    const limit = () => scalar('SELECT available_limit_cents AS v FROM credit_cards');
    const balance = () => scalar('SELECT current_balance_cents AS v FROM bank_accounts');

    const group = async (
        overrides: (number: number) => Record<string, unknown>,
        place: 'account' | 'card' = 'account',
    ): Promise<string[]> => {
        const id = randomUUID();
        const ids: string[] = [];

        for (const number of [1, 2, 3]) {
            ids.push(
                await (place === 'account' ? onAccount : onCard)({
                    group: { id, number, total: 3 },
                    ...overrides(number),
                }),
            );
        }

        return ids;
    };

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
        await ctx.dataSource.query(
            `UPDATE credit_cards SET available_limit_cents = ${INITIAL_LIMIT / 100}, archived_at = NULL`,
        );
        await ctx.dataSource.query('UPDATE bank_accounts SET archived_at = NULL');
    });

    it('AC-0012-22, AC-0013-08, INV-0012-15: conta OPEN de janeiro vai para o cartão, abate o limite e cai na fatura aberta; voltar devolve e zera postedOn', async () => {
        const id = await onAccount();
        const balanceBefore = await balance();

        const res = await toCard(id);

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toMatchObject({
            id,
            status: 'OPEN',
            bankAccountId: null,
            creditCardId: fx.cardId,
            postedOn: '2026-03-11',
            occurredOn: '2026-01-15',
        });
        expect(await limit()).toBe(INITIAL_LIMIT - 1000);

        const back = await toAccount(id);

        expect(back.status).toBe(200);
        expect(back.body.data[0]).toMatchObject({
            bankAccountId: fx.accountId,
            creditCardId: null,
            postedOn: null,
        });
        expect(await limit()).toBe(INITIAL_LIMIT);
        expect(await balance()).toBe(balanceBefore);
    });

    it('AC-0012-22: OVERDUE de conta chega ao cartão como OPEN; FORECAST troca sem mover limite; VERIFYING abate', async () => {
        const overdue = await onAccount({ status: 'OVERDUE' });
        const forecast = await onAccount({ status: 'FORECAST', occurredOn: '2026-03-18' });
        const verifying = await onAccount({ status: 'VERIFYING', occurredOn: '2026-03-18' });

        expect((await toCard(overdue)).body.data[0].status).toBe('OPEN');
        expect(await limit()).toBe(INITIAL_LIMIT - 1000);

        const moved = await toCard(forecast);

        expect(moved.body.data[0]).toMatchObject({ status: 'FORECAST', postedOn: '2026-03-18' });
        expect(await limit()).toBe(INITIAL_LIMIT - 1000);

        await toCard(verifying);
        expect(await limit()).toBe(INITIAL_LIMIT - 2000);
        expect((await row(verifying)).status).toBe('VERIFYING');

        await toAccount(forecast);
        expect(await limit()).toBe(INITIAL_LIMIT - 2000);
    });

    it('postedOn informado vale no cartão de destino; antes de occurredOn é 400', async () => {
        const id = await onAccount({ occurredOn: '2026-03-12' });

        const early = await toCard(id, { postedOn: '2026-03-11' });

        expect(early.status).toBe(400);

        const ok = await toCard(id, { postedOn: '2026-03-25' });

        expect(ok.body.data[0].postedOn).toBe('2026-03-25');
    });

    it('AC-0012-22: despesa paga recebe 409 EXPENSE_ALREADY_PAID e nada muda', async () => {
        const id = await onAccount({ status: 'PAID' });

        const res = await toCard(id);

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('EXPENSE_ALREADY_PAID');
        expect(await limit()).toBe(INITIAL_LIMIT);
        expect((await row(id)).creditCardId).toBeNull();
    });

    it('AC-0012-22: cartão arquivado recebe 409 CREDIT_CARD_ARCHIVED; conta arquivada, BANK_ACCOUNT_ARCHIVED; inexistentes, 404', async () => {
        const id = await onAccount();
        const onCardId = await onCard();

        await ctx.dataSource.query('UPDATE credit_cards SET archived_at = now()');
        await ctx.dataSource.query('UPDATE bank_accounts SET archived_at = now()');

        const card = await toCard(id);
        const account = await toAccount(onCardId);
        const noCard = await change(id, { creditCardId: randomUUID() });
        const noAccount = await change(id, { bankAccountId: randomUUID() });
        const noExpense = await toCard(randomUUID());

        expect(card.status).toBe(409);
        expect(card.body.error.code).toBe('CREDIT_CARD_ARCHIVED');
        expect(account.status).toBe(409);
        expect(account.body.error.code).toBe('BANK_ACCOUNT_ARCHIVED');
        expect(noCard.status).toBe(404);
        expect(noCard.body.error.code).toBe('CREDIT_CARD_NOT_FOUND');
        expect(noAccount.status).toBe(404);
        expect(noAccount.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
        expect(noExpense.status).toBe(404);
        expect(noExpense.body.error.code).toBe('EXPENSE_NOT_FOUND');
    });

    it('destino igual à origem responde 200 sem efeito', async () => {
        const onCardId = await onCard();
        const onAccountId = await onAccount();
        const limitBefore = await limit();

        const sameCard = await toCard(onCardId);
        const sameAccount = await toAccount(onAccountId);

        expect(sameCard.status).toBe(200);
        expect(sameCard.body.data[0].postedOn).toBe('2026-03-15');
        expect(sameAccount.status).toBe(200);
        expect(await limit()).toBe(limitBefore);
    });

    it('AC-0012-23: parcela de grupo em 3x com a parcela 1 paga move as parcelas 2 e 3 e mantém a 1; a resposta vem em ordem de parcela', async () => {
        const [first, second, third] = await group((n) => ({
            status: n === 1 ? 'PAID' : 'OPEN',
            occurredOn: `2026-0${n + 1}-15`,
        }));

        const res = await toCard(third!);

        expect(res.status).toBe(200);
        expect(res.body.data.map((e: { id: string }) => e.id)).toEqual([second, third]);
        expect(
            res.body.data.map((e: { installment: { number: number } }) => e.installment.number),
        ).toEqual([2, 3]);
        expect((await row(first!)).creditCardId).toBeNull();
        expect((await row(second!)).creditCardId).toBe(fx.cardId);
        expect(await limit()).toBe(INITIAL_LIMIT - 2000);
    });

    it('AC-0012-23: trocar a parcela paga recebe 409 EXPENSE_ALREADY_PAID', async () => {
        const [first] = await group((n) => ({ status: n === 1 ? 'PAID' : 'OPEN' }));

        const res = await toCard(first!);

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('EXPENSE_ALREADY_PAID');
    });

    it('AC-0013-10, ERR-0013-08: despesa de cartão em fatura fechada recebe 409 STATEMENT_CLOSED e nada muda', async () => {
        const id = await onCard({ occurredOn: '2026-03-05' });
        const limitBefore = await limit();

        const res = await toAccount(id);

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('STATEMENT_CLOSED');
        expect(res.body.error.message).toContain(CLOSED_THROUGH);
        expect((await row(id)).creditCardId).toBe(fx.cardId);
        expect(await limit()).toBe(limitBefore);
    });

    it('AC-0013-10: postedOn informado dentro da janela fechada do destino recebe 409 STATEMENT_CLOSED', async () => {
        const id = await onAccount({ occurredOn: '2026-03-01' });

        const res = await toCard(id, { postedOn: '2026-03-05' });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('STATEMENT_CLOSED');
        expect(await limit()).toBe(INITIAL_LIMIT);
    });

    it('AC-0013-11: parcelas de cartão em fatura fechada ficam onde estão; as abertas voltam para a conta e devolvem o limite', async () => {
        const [first, second, third] = await group(
            (n) => ({ occurredOn: n === 1 ? '2026-03-05' : '2026-03-15' }),
            'card',
        );

        const res = await toAccount(third!);

        expect(res.status).toBe(200);
        expect(res.body.data.map((e: { id: string }) => e.id)).toEqual([second, third]);
        expect((await row(first!)).creditCardId).toBe(fx.cardId);
        expect(await row(second!)).toMatchObject({ creditCardId: null, postedOn: null });
        expect(await limit()).toBe(INITIAL_LIMIT + 2000);
    });

    it('VIEWER recebe 403 e payload inválido recebe 400', async () => {
        const id = await onAccount();

        await request(ctx.app).get('/users/me').set('Authorization', VIEWER);
        await ctx.setProfile('uid-viewer', 'VIEWER');

        expect((await toCard(id, {}, VIEWER)).status).toBe(403);
        expect((await change(id, {})).status).toBe(400);
        expect(
            (await change(id, { bankAccountId: fx.accountId, creditCardId: fx.cardId })).status,
        ).toBe(400);
        expect(
            (await change(id, { bankAccountId: fx.accountId, postedOn: '2026-03-20' })).status,
        ).toBe(400);
        expect((await change(id, { creditCardId: fx.cardId, extra: 1 })).status).toBe(400);
    });
});
