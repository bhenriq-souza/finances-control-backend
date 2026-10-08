import { container } from '../../../src/container';
import { ExpenseServiceSymbol, type ExpenseService } from '../../../src/expenses';
import { startApp, stopApp, type TestApp } from '../app.helper';
import { cleanFixture, insertExpense, seedFixture, type Fixture } from './fixture.helper';

const SCHEMA = 'test_expenses_mark_paid_by_statement';
const at = (iso: string): Date => new Date(`${iso}T12:00:00.000Z`);

describe('ExpenseService.markPaidByStatement (spec 0013, interface pública do expenses)', () => {
    let ctx: TestApp;
    let fx: Fixture;
    let service: ExpenseService;

    const rowOf = async (id: string) =>
        (
            (await ctx.dataSource.query(
                "SELECT status, to_char(paid_on, 'YYYY-MM-DD') AS paid_on FROM expenses WHERE id = $1",
                [id],
            )) as { status: string; paid_on: string | null }[]
        )[0]!;

    const limitOf = async (): Promise<string> =>
        (
            (await ctx.dataSource.query(
                'SELECT available_limit_cents FROM credit_cards WHERE id = $1',
                [fx.cardId],
            )) as { available_limit_cents: string }[]
        )[0]!.available_limit_cents;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        service = container.resolve<ExpenseService>(ExpenseServiceSymbol);
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

    it('quita só OPEN e VERIFYING do cartão com posted_on na janela inclusiva, com o paidOn dado', async () => {
        const base = { typeId: fx.typeId, cardId: fx.cardId };
        const first = await insertExpense(ctx, { ...base, occurredOn: '2026-03-01' });
        const last = await insertExpense(ctx, {
            ...base,
            status: 'VERIFYING',
            occurredOn: '2026-03-31',
        });
        const forecast = await insertExpense(ctx, {
            ...base,
            status: 'FORECAST',
            occurredOn: '2026-03-10',
        });
        const alreadyPaid = await insertExpense(ctx, {
            ...base,
            status: 'PAID',
            occurredOn: '2026-03-11',
        });
        const before = await insertExpense(ctx, { ...base, occurredOn: '2026-02-28' });
        const after = await insertExpense(ctx, { ...base, occurredOn: '2026-04-01' });
        const account = await insertExpense(ctx, {
            typeId: fx.typeId,
            accountId: fx.accountId,
            occurredOn: '2026-03-10',
        });
        const limitBefore = await limitOf();

        const result = await ctx.dataSource.transaction((manager) =>
            service.markPaidByStatement(
                manager,
                fx.cardId,
                { from: at('2026-03-01'), to: at('2026-03-31') },
                at('2026-04-05'),
            ),
        );

        expect(result).toEqual({ count: 2 });
        expect(await rowOf(first)).toEqual({ status: 'PAID', paid_on: '2026-04-05' });
        expect(await rowOf(last)).toEqual({ status: 'PAID', paid_on: '2026-04-05' });
        expect((await rowOf(forecast)).status).toBe('FORECAST');
        expect((await rowOf(alreadyPaid)).status).toBe('PAID');
        expect((await rowOf(alreadyPaid)).paid_on).toBe('2026-03-11');
        expect((await rowOf(before)).status).toBe('OPEN');
        expect((await rowOf(after)).status).toBe('OPEN');
        expect((await rowOf(account)).status).toBe('OPEN');
        expect(await limitOf()).toBe(limitBefore);
    });

    it('escreve com o manager recebido: o rollback da transação de quem chamou desfaz a quitação', async () => {
        const id = await insertExpense(ctx, { typeId: fx.typeId, cardId: fx.cardId });

        await expect(
            ctx.dataSource.transaction(async (manager) => {
                const { count } = await service.markPaidByStatement(
                    manager,
                    fx.cardId,
                    { from: at('2026-03-01'), to: at('2026-03-31') },
                    at('2026-04-05'),
                );

                expect(count).toBe(1);
                throw new Error('rollback');
            }),
        ).rejects.toThrow('rollback');

        expect((await rowOf(id)).status).toBe('OPEN');
    });

    it('janela sem despesa devolve count 0', async () => {
        const result = await ctx.dataSource.transaction((manager) =>
            service.markPaidByStatement(
                manager,
                fx.cardId,
                { from: at('2026-03-01'), to: at('2026-03-31') },
                at('2026-04-05'),
            ),
        );

        expect(result).toEqual({ count: 0 });
    });
});
