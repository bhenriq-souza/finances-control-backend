import {
    BankAccountServiceSymbol,
    CreditCardServiceSymbol,
    type BankAccountService,
    type CreditCardService,
} from '../../../src/accounts';
import { container } from '../../../src/container';
import { ExpenseServiceSymbol, type ExpenseService } from '../../../src/expenses';
import { startApp, stopApp, type TestApp } from '../app.helper';
import { insertDomainRows, type DomainRows } from '../helpers/domain-rows.helper';
import { createTwoWorkspaces, type TwoWorkspaces } from '../helpers/workspaces.helper';

const SCHEMA = 'test_cross_module_workspace';
const WINDOW = { from: new Date('2026-03-01T12:00:00Z'), to: new Date('2026-03-31T12:00:00Z') };
const PAID_ON = new Date('2026-04-05T12:00:00Z');

/**
 * As interfaces públicas entre módulos recebem o espaço como parâmetro explícito e
 * filtram por ele: o id de outro espaço se comporta como id inexistente (spec 0021,
 * Escopo nas consultas; ADR-0003 local).
 */
describe('interfaces entre módulos: espaço explícito (INV-0021-03, INV-0021-06)', () => {
    let ctx: TestApp;
    let spaces: TwoWorkspaces;
    let a: DomainRows;
    let b: DomainRows;
    let accounts: BankAccountService;
    let cards: CreditCardService;
    let expenses: ExpenseService;

    const column = async (table: string, name: string, id: string): Promise<number> => {
        const [row] = (await ctx.dataSource.query(
            `SELECT ${name} AS v FROM ${table} WHERE id = $1`,
            [id],
        )) as [{ v: string }];

        // numeric(14,2) holds reais; the services work in cents.
        return Math.round(Number(row.v) * 100);
    };

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        spaces = await createTwoWorkspaces(ctx);
        accounts = container.resolve<BankAccountService>(BankAccountServiceSymbol);
        cards = container.resolve<CreditCardService>(CreditCardServiceSymbol);
        expenses = container.resolve<ExpenseService>(ExpenseServiceSymbol);

        const [bank] = (await ctx.dataSource.query(
            "INSERT INTO banks (febraban_code, name) VALUES ('260', 'Nu') RETURNING id",
        )) as [{ id: string }];

        a = await insertDomainRows(ctx.dataSource, {
            bankId: bank.id,
            workspaceId: spaces.a.workspaceId,
            tag: 'a',
        });
        b = await insertDomainRows(ctx.dataSource, {
            bankId: bank.id,
            workspaceId: spaces.b.workspaceId,
            tag: 'b',
        });
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    describe('contas', () => {
        it('INV-0021-03: findById com o espaço certo acha a conta, com o de outro é BANK_ACCOUNT_NOT_FOUND', async () => {
            await expect(
                accounts.findById(spaces.a.workspaceId, a.accountId),
            ).resolves.toMatchObject({ id: a.accountId });
            await expect(
                accounts.findById(spaces.a.workspaceId, b.accountId),
            ).rejects.toMatchObject({ code: 'BANK_ACCOUNT_NOT_FOUND' });
        });

        it('INV-0021-03: applyBalanceDelta move a conta do espaço, e a de outro espaço é BANK_ACCOUNT_NOT_FOUND sem mexer no saldo', async () => {
            await expect(
                ctx.dataSource.transaction((manager) =>
                    accounts.applyBalanceDelta(manager, spaces.a.workspaceId, b.accountId, -10),
                ),
            ).rejects.toMatchObject({ code: 'BANK_ACCOUNT_NOT_FOUND' });
            expect(await column('bank_accounts', 'current_balance_cents', b.accountId)).toBe(10000);

            await ctx.dataSource.transaction((manager) =>
                accounts.applyBalanceDelta(manager, spaces.a.workspaceId, a.accountId, -10),
            );
            expect(await column('bank_accounts', 'current_balance_cents', a.accountId)).toBe(9990);
        });
    });

    describe('cartões', () => {
        it('INV-0021-03: findById com o espaço certo acha o cartão, com o de outro é CREDIT_CARD_NOT_FOUND', async () => {
            await expect(cards.findById(spaces.a.workspaceId, a.cardId)).resolves.toMatchObject({
                id: a.cardId,
            });
            await expect(cards.findById(spaces.a.workspaceId, b.cardId)).rejects.toMatchObject({
                code: 'CREDIT_CARD_NOT_FOUND',
            });
        });

        it('INV-0021-03: list devolve só os cartões do espaço', async () => {
            const inA = await cards.list(spaces.a.workspaceId, { archived: 'true' });
            const inB = await cards.list(spaces.b.workspaceId, { archived: 'true' });

            expect(inA.map((card) => card.id)).toEqual([a.cardId]);
            expect(inB.map((card) => card.id)).toEqual([b.cardId]);
        });

        it('INV-0021-03: applyAvailableLimitDelta move o cartão do espaço, e o de outro espaço é CREDIT_CARD_NOT_FOUND sem mexer no limite', async () => {
            await expect(
                ctx.dataSource.transaction((manager) =>
                    cards.applyAvailableLimitDelta(manager, spaces.a.workspaceId, b.cardId, -10),
                ),
            ).rejects.toMatchObject({ code: 'CREDIT_CARD_NOT_FOUND' });
            expect(await column('credit_cards', 'available_limit_cents', b.cardId)).toBe(100000);

            await ctx.dataSource.transaction((manager) =>
                cards.applyAvailableLimitDelta(manager, spaces.a.workspaceId, a.cardId, -10),
            );
            expect(await column('credit_cards', 'available_limit_cents', a.cardId)).toBe(99990);
        });

        it('INV-0021-06: listAllForJobs atravessa todos os espaços e devolve o espaço de cada cartão', async () => {
            const all = await cards.listAllForJobs();

            expect(all).toEqual(
                expect.arrayContaining([
                    { id: a.cardId, workspaceId: spaces.a.workspaceId },
                    { id: b.cardId, workspaceId: spaces.b.workspaceId },
                ]),
            );
        });
    });

    describe('despesas', () => {
        it('INV-0021-03: findById com o espaço certo acha a despesa, com o de outro é EXPENSE_NOT_FOUND', async () => {
            await expect(
                expenses.findById(spaces.a.workspaceId, a.expenseId),
            ).resolves.toMatchObject({ id: a.expenseId });
            await expect(
                expenses.findById(spaces.a.workspaceId, b.expenseId),
            ).rejects.toMatchObject({ code: 'EXPENSE_NOT_FOUND' });
        });

        it('INV-0021-03: listByCreditCard com o espaço de outro devolve vazio', async () => {
            const own = await expenses.listByCreditCard(spaces.a.workspaceId, a.cardId, WINDOW);
            const foreign = await expenses.listByCreditCard(spaces.a.workspaceId, b.cardId, WINDOW);

            expect(own.map((row) => row.id)).toEqual([a.cardExpenseId]);
            expect(foreign).toEqual([]);
        });

        it('INV-0021-03: findCardExpense com o espaço de outro devolve null', async () => {
            const find = (workspaceId: string, id: string) =>
                ctx.dataSource.transaction((manager) =>
                    expenses.findCardExpense(manager, workspaceId, id),
                );

            await expect(find(spaces.a.workspaceId, a.cardExpenseId)).resolves.toMatchObject({
                id: a.cardExpenseId,
                creditCardId: a.cardId,
            });
            await expect(find(spaces.a.workspaceId, b.cardExpenseId)).resolves.toBeNull();
        });

        it('INV-0021-03: markPaidByStatement e markUnpaidByStatement com o espaço de outro mudam zero linhas', async () => {
            const paid = (workspaceId: string, cardId: string) =>
                ctx.dataSource.transaction((manager) =>
                    expenses.markPaidByStatement(manager, workspaceId, cardId, WINDOW, PAID_ON),
                );
            const unpaid = (workspaceId: string, cardId: string) =>
                ctx.dataSource.transaction((manager) =>
                    expenses.markUnpaidByStatement(manager, workspaceId, cardId, WINDOW),
                );

            await expect(paid(spaces.a.workspaceId, b.cardId)).resolves.toEqual({ count: 0 });
            await expect(paid(spaces.a.workspaceId, a.cardId)).resolves.toEqual({ count: 1 });
            // A despesa de A está paga; o espaço de B não a desfaz, o de A sim.
            await expect(unpaid(spaces.b.workspaceId, a.cardId)).resolves.toEqual({ count: 0 });
            await expect(unpaid(spaces.a.workspaceId, a.cardId)).resolves.toEqual({ count: 1 });
            await expect(unpaid(spaces.a.workspaceId, b.cardId)).resolves.toEqual({ count: 0 });
        });
    });
});
