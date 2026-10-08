import { Bank, BankAccount, CreditCard } from '../../../src/accounts';
import { container } from '../../../src/container';
import {
    STATEMENT_CLOSED,
    STATEMENT_PAID,
    type StatementClosed,
    type StatementPaid,
} from '../../../src/events';
import { Expense, ExpenseType, type ExpenseStatus } from '../../../src/expenses';
import { DomainEventDispatcherSymbol, type DomainEventDispatcher } from '../../../src/platform';
import {
    CreditCardRefund,
    CreditCardStatement,
    CreditCardStatementPayment,
    StatementService,
} from '../../../src/statements';
import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_statements_rollover';
const at = (iso: string): Date => new Date(`${iso}T12:00:00.000Z`);

describe('rolagem e quitação no fechamento (spec 0013, Fechamento)', () => {
    let ctx: TestApp;
    let service: StatementService;
    let cardId: string;
    let accountId: string;
    let typeId: string;
    let closed: StatementClosed[];
    let paid: StatementPaid[];
    let unsubscribe: () => void;

    const addExpense = async (
        postedOn: string,
        amountCents: number,
        status: ExpenseStatus = 'OPEN',
    ): Promise<string> =>
        (
            await ctx.dataSource.getRepository(Expense).save({
                description: 'Compra',
                expenseTypeId: typeId,
                kind: 'VARIABLE',
                status,
                amountCents,
                occurredOn: postedOn,
                paidOn: status === 'PAID' ? postedOn : null,
                bankAccountId: null,
                creditCardId: cardId,
                postedOn,
                installmentGroupId: null,
                installmentNumber: null,
                installmentTotal: null,
                notes: null,
            })
        ).id;

    const addRefund = (postedOn: string, amountCents: number) =>
        ctx.dataSource.getRepository(CreditCardRefund).save({
            creditCardId: cardId,
            expenseId: null,
            description: 'Estorno',
            amountCents,
            occurredOn: postedOn,
            postedOn,
            notes: null,
        });

    const addPayment = (amountCents: number, paidOn: string, statementId: string | null = null) =>
        ctx.dataSource.getRepository(CreditCardStatementPayment).save({
            creditCardId: cardId,
            statementId,
            bankAccountId: accountId,
            amountCents,
            paidOn,
        });

    const statementAt = (closesOn: string) =>
        ctx.dataSource
            .getRepository(CreditCardStatement)
            .findOneByOrFail({ creditCardId: cardId, closesOn });

    const expenseRow = (id: string) =>
        ctx.dataSource.getRepository(Expense).findOneByOrFail({ id });

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        service = container.resolve(StatementService);
        typeId = (
            await ctx.dataSource.getRepository(ExpenseType).findOneByOrFail({ name: 'Outros' })
        ).id;
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        const bank = await ctx.dataSource
            .getRepository(Bank)
            .save({ febrabanCode: '260', name: 'Banco de Teste', archivedAt: null });

        accountId = (
            await ctx.dataSource.getRepository(BankAccount).save({
                bankId: bank.id,
                type: 'CHECKING',
                accountNumber: '1-1',
                description: 'Conta',
                openingBalanceCents: 0,
                currentBalanceCents: 0,
                overdraftLimitCents: 0,
                archivedAt: null,
            })
        ).id;
        cardId = (
            await ctx.dataSource.getRepository(CreditCard).save({
                bankId: bank.id,
                name: 'Cartão',
                creditLimitCents: 500000,
                availableLimitCents: 500000,
                closingDay: 10,
                dueDay: 20,
                archivedAt: null,
            })
        ).id;
        await ctx.dataSource.query(
            "UPDATE credit_cards SET created_at = '2026-01-15T12:00:00Z' WHERE id = $1",
            [cardId],
        );

        closed = [];
        paid = [];

        const dispatcher = container.resolve<DomainEventDispatcher>(DomainEventDispatcherSymbol);
        const offClosed = dispatcher.subscribe<StatementClosed>(STATEMENT_CLOSED, (event) => {
            closed.push(event);
        });
        const offPaid = dispatcher.subscribe<StatementPaid>(STATEMENT_PAID, (event) => {
            paid.push(event);
        });

        unsubscribe = () => {
            offClosed();
            offPaid();
        };
    });

    afterEach(async () => {
        unsubscribe();
        await ctx.dataSource.query('DELETE FROM credit_card_statement_payments');
        await ctx.dataSource.query('DELETE FROM credit_card_refunds');
        await ctx.dataSource.query('DELETE FROM credit_card_statements');
        await ctx.dataSource.query('DELETE FROM expenses');
        await ctx.dataSource.query('DELETE FROM credit_cards');
        await ctx.dataSource.query('DELETE FROM bank_accounts');
        await ctx.dataSource.query('DELETE FROM banks');
    });

    it('AC-0013-15, INV-0013-09, INV-0013-10: fatura de 1500 com 400 pagos rola; a nova nasce com previousBalance 1100 e amountDue = total + 1100', async () => {
        await addExpense('2026-02-05', 1500);
        await service.closeDue(at('2026-02-11'), cardId);

        const february = await statementAt('2026-02-10');
        expect(february.status).toBe('CLOSED');
        expect(february.previousBalanceCents).toBe(0);

        await addPayment(400, '2026-02-15', february.id);
        await addExpense('2026-03-02', 700);
        await service.closeDue(at('2026-03-11'), cardId);

        expect((await statementAt('2026-02-10')).status).toBe('ROLLED_OVER');

        const march = await statementAt('2026-03-10');
        expect(march.status).toBe('CLOSED');
        expect(march.previousBalanceCents).toBe(1100);

        const marchEvent = closed.find((event) => event.payload.statementId === march.id);
        expect(marchEvent?.payload).toMatchObject({
            totalCents: 700,
            previousBalanceCents: 1100,
            amountDueCents: 1800,
        });
        expect(paid).toHaveLength(0);
    });

    it('INV-0013-10: o restante da rolada está inteiro, e uma vez só, na fatura seguinte', async () => {
        await addExpense('2026-02-05', 1500);
        await service.closeDue(at('2026-02-11'), cardId);
        await addPayment(400, '2026-02-15', (await statementAt('2026-02-10')).id);
        await addExpense('2026-03-02', 700);

        // Março e abril fecham em sequência: o restante de fevereiro (1100) já vive dentro do
        // devido de março (1800) e só este é carregado para abril.
        await service.closeDue(at('2026-04-11'), cardId);

        expect((await statementAt('2026-02-10')).status).toBe('ROLLED_OVER');
        expect((await statementAt('2026-03-10')).status).toBe('ROLLED_OVER');

        const april = await statementAt('2026-04-10');
        expect(april.status).toBe('CLOSED');
        expect(april.previousBalanceCents).toBe(1800);
        expect((await statementAt('2026-03-10')).previousBalanceCents).toBe(1100);
    });

    it('INV-0013-09: fatura anterior quitada não leva nada para a seguinte e continua PAID', async () => {
        await addExpense('2026-02-05', 1500);
        await service.closeDue(at('2026-02-11'), cardId);
        const february = await statementAt('2026-02-10');
        await addPayment(1500, '2026-02-15', february.id);
        // O pagamento (T-0013-06) quita a fatura; aqui a quitação é montada direto.
        await ctx.dataSource.query(
            "UPDATE credit_card_statements SET status = 'PAID' WHERE id = $1",
            [february.id],
        );
        await service.closeDue(at('2026-03-11'), cardId);

        expect((await statementAt('2026-02-10')).status).toBe('PAID');
        expect((await statementAt('2026-03-10')).previousBalanceCents).toBe(0);
    });

    it('AC-0013-16: estornos acima das compras em 200 fecham PAID, publicam StatementPaid e a seguinte nasce com previousBalance -200', async () => {
        const purchase = await addExpense('2026-02-05', 1000);
        const forecast = await addExpense('2026-02-06', 900, 'FORECAST');
        await addRefund('2026-02-07', 1200);
        await service.closeDue(at('2026-02-11'), cardId);

        const february = await statementAt('2026-02-10');
        expect(february.status).toBe('PAID');
        expect(paid).toHaveLength(1);
        expect(paid[0]?.payload).toEqual({
            statementId: february.id,
            creditCardId: cardId,
            paidOn: '2026-02-10',
        });
        expect(closed[0]?.payload).toMatchObject({
            totalCents: -200,
            previousBalanceCents: 0,
            amountDueCents: -200,
        });

        const settled = await expenseRow(purchase);
        expect([settled.status, settled.paidOn]).toEqual(['PAID', '2026-02-10']);
        expect((await expenseRow(forecast)).status).toBe('FORECAST');

        await addExpense('2026-03-02', 300);
        await service.closeDue(at('2026-03-11'), cardId);

        const march = await statementAt('2026-03-10');
        expect(march.previousBalanceCents).toBe(-200);
        expect(march.status).toBe('CLOSED');
        expect((await statementAt('2026-02-10')).status).toBe('PAID');
        expect(closed[1]?.payload).toMatchObject({
            totalCents: 300,
            previousBalanceCents: -200,
            amountDueCents: 100,
        });
    });

    it('pagamentos antecipados passam a apontar para a fatura que nasce; cobrindo o devido, ela nasce PAID com o paidOn do último', async () => {
        const february = await addExpense('2026-02-05', 1500);
        const verifying = await addExpense('2026-02-06', 500, 'VERIFYING');
        await service.closeDue(at('2026-02-11'), cardId);
        await addPayment(400, '2026-02-15', (await statementAt('2026-02-10')).id);

        const march = await addExpense('2026-03-02', 200);
        const early = await addPayment(1000, '2026-03-03');
        const last = await addPayment(800, '2026-03-05');
        await service.closeDue(at('2026-03-11'), cardId);

        const statement = await statementAt('2026-03-10');
        // devido = 200 + (2000 - 400) = 1800; pago = 1000 + 800 = 1800.
        expect(statement.status).toBe('PAID');
        expect(statement.previousBalanceCents).toBe(1600);
        expect((await statementAt('2026-02-10')).status).toBe('ROLLED_OVER');

        const payments = await ctx.dataSource
            .getRepository(CreditCardStatementPayment)
            .find({ where: [{ id: early.id }, { id: last.id }] });
        expect(payments.map((payment) => payment.statementId)).toEqual([
            statement.id,
            statement.id,
        ]);

        // A cadeia inclui a janela da rolada.
        for (const id of [february, verifying, march]) {
            const row = await expenseRow(id);
            expect([row.status, row.paidOn]).toEqual(['PAID', '2026-03-05']);
        }

        expect(paid.map((event) => event.payload)).toEqual([
            { statementId: statement.id, creditCardId: cardId, paidOn: '2026-03-05' },
        ]);
    });
});
