import type { CardExpenseSummary } from '../../src/expenses';
import { summarizeStatement, type StatementBase } from '../../src/statements/statement-view';

const TODAY = '2026-05-21';

const base = (overrides: Partial<StatementBase> = {}): StatementBase => ({
    id: 's1',
    creditCardId: 'c1',
    status: 'CLOSED',
    startsOn: '2026-04-11',
    closesOn: '2026-05-10',
    dueOn: '2026-05-20',
    previousBalanceCents: 0,
    minimumPaymentCents: null,
    closedAt: new Date('2026-05-11T00:00:00Z'),
    payments: [],
    current: false,
    ...overrides,
});

const expense = (
    amountCents: number,
    status: CardExpenseSummary['status'],
    type: [string, string],
): CardExpenseSummary => ({
    id: `e-${amountCents}-${status}`,
    description: 'Compra',
    occurredOn: '2026-04-12',
    postedOn: '2026-04-12',
    amountCents,
    status,
    expenseType: { id: type[0], name: type[1] },
    installment: null,
});

const paying = (...amounts: number[]): StatementBase['payments'] =>
    amounts.map((amountCents, index) => ({
        id: `p${index}`,
        creditCardId: 'c1',
        statementId: 's1',
        bankAccountId: 'a1',
        amountCents,
        paidOn: '2026-05-15',
        createdAt: new Date(),
        updatedAt: new Date(),
    }));

const view = (
    b: StatementBase,
    expenses: CardExpenseSummary[] = [expense(1000, 'OPEN', ['t', 'T'])],
) => summarizeStatement(b, expenses, [], TODAY, false);

describe('summarizeStatement (spec 0013, Valores de uma fatura)', () => {
    it('INV-0013-02, AC-0013-09: FORECAST fica de fora e total = compras - estornos', () => {
        const result = summarizeStatement(
            base(),
            [
                expense(1000, 'OPEN', ['m', 'Mercado']),
                expense(500, 'VERIFYING', ['l', 'Lazer']),
                expense(300, 'FORECAST', ['m', 'Mercado']),
            ],
            [{ amountCents: 200 } as never],
            TODAY,
            false,
        );

        expect(result).toMatchObject({
            purchasesCents: 1500,
            refundsCents: 200,
            totalCents: 1300,
            amountDueCents: 1300,
        });
        expect(result.byExpenseType.reduce((sum, group) => sum + group.totalCents, 0)).toBe(1500);
    });

    it('byExpenseType: total decrescente e depois nome', () => {
        const result = summarizeStatement(
            base(),
            [
                expense(200, 'OPEN', ['b', 'Beta']),
                expense(200, 'PAID', ['a', 'Alfa']),
                expense(900, 'OPEN', ['z', 'Zeta']),
                expense(50, 'OPEN', ['b', 'Beta']),
            ],
            [],
            TODAY,
            false,
        );

        expect(result.byExpenseType.map((group) => [group.name, group.totalCents])).toEqual([
            ['Zeta', 900],
            ['Beta', 250],
            ['Alfa', 200],
        ]);
    });

    it('o total pode ser negativo e o devido soma o saldo anterior', () => {
        const result = summarizeStatement(
            base({ previousBalanceCents: -100 }),
            [expense(300, 'OPEN', ['t', 'T'])],
            [{ amountCents: 500 } as never],
            TODAY,
            false,
        );

        expect(result).toMatchObject({
            totalCents: -200,
            amountDueCents: -300,
            remainingCents: -300,
        });
    });

    describe('AC-0013-17: overdue', () => {
        it('com mínimo 300 e vencimento passado: 200 pagos está vencida; 300 pagos, não', () => {
            expect(view(base({ minimumPaymentCents: 300, payments: paying(200) })).overdue).toBe(
                true,
            );
            expect(
                view(base({ minimumPaymentCents: 300, payments: paying(200, 100) })).overdue,
            ).toBe(false);
        });

        it('sem mínimo só sai do atraso quitada; mínimo maior que o devido vale como informado', () => {
            expect(view(base({ payments: paying(999) })).overdue).toBe(true);
            expect(view(base({ payments: paying(1000) })).overdue).toBe(false);
            expect(view(base({ minimumPaymentCents: 5000, payments: paying(1000) })).overdue).toBe(
                true,
            );
        });

        it('nunca vencida: antes do vencimento, quitada, rolada ou aberta', () => {
            expect(view(base({ dueOn: '2026-05-21' })).overdue).toBe(false);
            expect(view(base({ status: 'PAID' })).overdue).toBe(false);
            expect(view(base({ status: 'ROLLED_OVER' })).overdue).toBe(false);
            expect(view(base({ id: null, status: 'OPEN', current: true })).overdue).toBe(false);
        });
    });

    it('o detalhe só vem quando pedido', () => {
        expect(view(base())).not.toHaveProperty('expenses');
        expect(summarizeStatement(base(), [], [], TODAY, true)).toMatchObject({
            expenses: [],
            refunds: [],
            payments: [],
        });
    });
});
