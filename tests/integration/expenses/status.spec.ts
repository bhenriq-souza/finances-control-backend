import request from 'supertest';

import { container } from '../../../src/container';
import { EXPENSE_PAID, type ExpensePaid } from '../../../src/events';
import { DomainEventDispatcherSymbol, type DomainEventDispatcher } from '../../../src/platform';
import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_expenses_status';
const ADMIN = 'Bearer uid-admin';

describe('despesa: máquina de status (spec 0012)', () => {
    let ctx: TestApp;
    let accountId: string;
    let cardId: string;
    let typeId: string;

    const send = (path: string, body: Record<string, unknown>) =>
        request(ctx.app).post(path).set('Authorization', ADMIN).send(body);

    const create = (overrides: Record<string, unknown> = {}) =>
        send('/expenses', {
            description: 'Compra',
            expenseTypeId: typeId,
            kind: 'VARIABLE',
            amountCents: 20000,
            occurredOn: '2026-03-10',
            bankAccountId: accountId,
            ...overrides,
        });

    const createId = async (overrides: Record<string, unknown> = {}): Promise<string> =>
        (await create(overrides)).body.data[0].id as string;

    const patch = (id: string, body: Record<string, unknown>) =>
        request(ctx.app).patch(`/expenses/${id}/status`).set('Authorization', ADMIN).send(body);

    const setStatus = async (id: string, status: string): Promise<void> => {
        await ctx.dataSource.query(
            'UPDATE expenses SET status = $2, paid_on = $3::date WHERE id = $1',
            [id, status, status === 'PAID' ? '2026-03-01' : null],
        );
    };

    const balance = async (): Promise<number> =>
        (await request(ctx.app).get(`/bank-accounts/${accountId}`).set('Authorization', ADMIN)).body
            .data.currentBalanceCents as number;

    const limit = async (): Promise<number> =>
        (await request(ctx.app).get(`/credit-cards/${cardId}`).set('Authorization', ADMIN)).body
            .data.availableLimitCents as number;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        await request(ctx.app).get('/users/me').set('Authorization', ADMIN);
        await ctx.setProfile('uid-admin', 'ADMIN');

        const bank = await send('/banks', { febrabanCode: '260', name: 'Nu Pagamentos' });
        const bankId = bank.body.data.id as string;
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
        typeId = (await send('/expense-types', { name: 'T-Mercado' })).body.data.id as string;
    });

    afterEach(async () => {
        jest.useRealTimers();
        await ctx.dataSource.query('DELETE FROM expenses');
        await ctx.dataSource.query("DELETE FROM expense_types WHERE name LIKE 'T-%'");
        await ctx.dataSource.query('DELETE FROM credit_cards');
        await ctx.dataSource.query('DELETE FROM bank_accounts');
        await ctx.dataSource.query('DELETE FROM banks');
    });

    describe('pagamento de despesa de conta', () => {
        let received: ExpensePaid[];
        let unsubscribe: () => void;

        beforeEach(() => {
            received = [];
            unsubscribe = container
                .resolve<DomainEventDispatcher>(DomainEventDispatcherSymbol)
                .subscribe<ExpensePaid>(EXPENSE_PAID, async (event) => {
                    received.push(event);
                });
        });

        afterEach(() => unsubscribe());

        it('AC-0012-05, INV-0012-04, INV-0012-07: pagar abate o saldo, grava paidOn e publica ExpensePaid', async () => {
            const id = await createId();
            const res = await patch(id, { status: 'PAID', paidOn: '2026-03-12' });

            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({
                id,
                status: 'PAID',
                paidOn: '2026-03-12',
                expenseType: { id: typeId },
            });
            expect(await balance()).toBe(80000);
            expect(received).toHaveLength(1);
            expect(received[0]?.payload).toEqual({
                expenseId: id,
                amountCents: 20000,
                bankAccountId: accountId,
                paidOn: '2026-03-12',
            });
        });

        it.each(['OPEN', 'VERIFYING', 'OVERDUE'])(
            'AC-0012-05: %s pode ser paga',
            async (status) => {
                const id = await createId();
                await setStatus(id, status);

                expect((await patch(id, { status: 'PAID' })).status).toBe(200);
                expect(await balance()).toBe(80000);
            },
        );

        it('AC-0012-05, INV-0012-07: desfazer devolve o valor e zera paidOn, sem novo evento', async () => {
            const id = await createId();
            await patch(id, { status: 'PAID' });
            const res = await patch(id, { status: 'OPEN' });

            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({ status: 'OPEN', paidOn: null });
            expect(await balance()).toBe(100000);
            expect(received).toHaveLength(1);
        });

        it('AC-0012-24, INV-0012-16: sem paidOn, grava hoje no fuso de negócio (10/03 22h em São Paulo)', async () => {
            const id = await createId();

            jest.useFakeTimers({
                now: new Date('2026-03-11T01:00:00Z'),
                doNotFake: [
                    'nextTick',
                    'setImmediate',
                    'clearImmediate',
                    'setInterval',
                    'clearInterval',
                    'setTimeout',
                    'clearTimeout',
                    'queueMicrotask',
                    'performance',
                    'hrtime',
                ],
            });
            const res = await patch(id, { status: 'PAID' });
            jest.useRealTimers();

            expect(res.status).toBe(200);
            expect(res.body.data.paidOn).toBe('2026-03-10');
        });

        it('AC-0012-17, INV-0012-09: saldo insuficiente não barra o pagamento', async () => {
            const id = await createId({ amountCents: 900000 });

            expect((await patch(id, { status: 'PAID' })).status).toBe(200);
            expect(await balance()).toBe(-800000);
        });

        it('AC-0012-15: despesa antiga numa conta arquivada pode ser paga', async () => {
            const id = await createId();
            await request(ctx.app)
                .post(`/bank-accounts/${accountId}/archive`)
                .set('Authorization', ADMIN);

            expect((await patch(id, { status: 'PAID' })).status).toBe(200);
            expect(await balance()).toBe(80000);
        });

        it('ERR-0012-08: pagar duas vezes recebe 409 e não move o saldo de novo', async () => {
            const id = await createId();
            await patch(id, { status: 'PAID' });
            const res = await patch(id, { status: 'PAID' });

            expect(res.status).toBe(409);
            expect(await balance()).toBe(80000);
        });

        it('INV-0012-04, ADR-0003 regra 4: pagamentos concorrentes da mesma despesa movem o saldo uma vez', async () => {
            const id = await createId();
            const results = await Promise.all([
                patch(id, { status: 'PAID' }),
                patch(id, { status: 'PAID' }),
                patch(id, { status: 'PAID' }),
            ]);

            expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
            expect(await balance()).toBe(80000);
        }, 30_000);
    });

    describe('despesa de cartão', () => {
        it('AC-0012-06, INV-0012-05: pagar recebe 409 CREDIT_CARD_EXPENSE_PAID_BY_STATEMENT e nada muda', async () => {
            const id = await createId({ bankAccountId: undefined, creditCardId: cardId });
            const res = await patch(id, { status: 'PAID' });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('CREDIT_CARD_EXPENSE_PAID_BY_STATEMENT');
            expect(await limit()).toBe(30000);
            expect(await balance()).toBe(100000);

            const [row] = (await ctx.dataSource.query(
                'SELECT status, paid_on FROM expenses WHERE id = $1',
                [id],
            )) as [{ status: string; paid_on: string | null }];
            expect(row).toEqual({ status: 'OPEN', paid_on: null });
        });

        it('INV-0004-02, AC-0012-05: pagamento recusado não publica ExpensePaid', async () => {
            const received: ExpensePaid[] = [];
            const unsubscribe = container
                .resolve<DomainEventDispatcher>(DomainEventDispatcherSymbol)
                .subscribe<ExpensePaid>(EXPENSE_PAID, async (event) => {
                    received.push(event);
                });
            const cardExpense = await createId({ bankAccountId: undefined, creditCardId: cardId });
            const forecast = await createId({ status: 'FORECAST' });

            expect((await patch(cardExpense, { status: 'PAID' })).status).toBe(409);
            expect((await patch(forecast, { status: 'PAID' })).status).toBe(409);
            unsubscribe();

            expect(received).toHaveLength(0);
        });

        it('ERR-0012-09: despagar recebe 409 CREDIT_CARD_EXPENSE_PAID_BY_STATEMENT', async () => {
            const id = await createId({ bankAccountId: undefined, creditCardId: cardId });
            await setStatus(id, 'PAID');
            const res = await patch(id, { status: 'OPEN' });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('CREDIT_CARD_EXPENSE_PAID_BY_STATEMENT');
            expect(await limit()).toBe(30000);
        });

        it('AC-0012-04, INV-0012-03: FORECAST -> OPEN abate o limite', async () => {
            const id = await createId({
                bankAccountId: undefined,
                creditCardId: cardId,
                status: 'FORECAST',
            });
            expect(await limit()).toBe(50000);

            expect((await patch(id, { status: 'OPEN' })).status).toBe(200);
            expect(await limit()).toBe(30000);
        });

        it('INV-0012-03: OPEN <-> VERIFYING de cartão não move o limite', async () => {
            const id = await createId({ bankAccountId: undefined, creditCardId: cardId });

            expect((await patch(id, { status: 'VERIFYING' })).status).toBe(200);
            expect((await patch(id, { status: 'OPEN' })).status).toBe(200);
            expect(await limit()).toBe(30000);
        });
    });

    describe('tabela de transições', () => {
        const ALL = ['OPEN', 'FORECAST', 'PAID', 'OVERDUE', 'VERIFYING'];
        const ALLOWED = [
            ['FORECAST', 'OPEN'],
            ['OPEN', 'VERIFYING'],
            ['OVERDUE', 'VERIFYING'],
            ['VERIFYING', 'OPEN'],
            ['OPEN', 'PAID'],
            ['OVERDUE', 'PAID'],
            ['VERIFYING', 'PAID'],
            ['PAID', 'OPEN'],
        ];
        const isAllowed = (from: string, to: string) =>
            ALLOWED.some(([f, t]) => f === from && t === to);
        const pairs = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));

        it.each(pairs.filter(([from, to]) => isAllowed(from, to)))(
            'AC-0012-12: %s -> %s é aceita',
            async (from, to) => {
                const id = await createId();
                await setStatus(id, from);

                const res = await patch(id, { status: to });

                expect(res.status).toBe(200);
                expect(res.body.data.status).toBe(to);
                expect(res.body.data.paidOn === null).toBe(to !== 'PAID');
            },
        );

        it.each(pairs.filter(([from, to]) => !isAllowed(from, to)))(
            'AC-0012-12, ERR-0012-08: %s -> %s recebe 409',
            async (from, to) => {
                const id = await createId();
                await setStatus(id, from);

                const res = await patch(id, { status: to });

                expect(res.status).toBe(409);
                expect(res.body.error.code).toBe('EXPENSE_STATUS_TRANSITION_NOT_ALLOWED');
                expect(res.body.error.message).toContain(from);
                expect(res.body.error.message).toContain(to);
            },
        );

        it('INV-0012-08: FORECAST e OVERDUE como alvo são recusados', async () => {
            const id = await createId();

            for (const status of ['FORECAST', 'OVERDUE']) {
                expect((await patch(id, { status })).status).toBe(409);
            }
        });

        it('INV-0012-04: VERIFYING e OPEN de conta não movem o saldo', async () => {
            const id = await createId();
            await patch(id, { status: 'VERIFYING' });
            await patch(id, { status: 'OPEN' });

            expect(await balance()).toBe(100000);
        });
    });

    describe('validação e erros de acesso', () => {
        it('ERR-0012-02: despesa inexistente recebe 404 EXPENSE_NOT_FOUND', async () => {
            const res = await patch('00000000-0000-4000-8000-000000000000', { status: 'PAID' });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('EXPENSE_NOT_FOUND');
        });

        it('paidOn com status diferente de PAID recebe 400 citando o campo', async () => {
            const id = await createId();
            const res = await patch(id, { status: 'VERIFYING', paidOn: '2026-03-12' });

            expect(res.status).toBe(400);
            expect(JSON.stringify(res.body)).toContain('paidOn');
        });

        it('status desconhecido recebe 400', async () => {
            const id = await createId();

            expect((await patch(id, { status: 'DONE' })).status).toBe(400);
        });
    });
});
