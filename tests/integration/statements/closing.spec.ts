import { Bank, CreditCard } from '../../../src/accounts';
import { container } from '../../../src/container';
import { STATEMENT_CLOSED, type StatementClosed } from '../../../src/events';
import { DomainEventDispatcherSymbol, type DomainEventDispatcher } from '../../../src/platform';
import { CreditCardStatement, StatementService } from '../../../src/statements';
import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_statements_closing';
const at = (iso: string): Date => new Date(`${iso}T12:00:00.000Z`);

describe('fechamento: closeDue (spec 0013, Fechamento)', () => {
    let ctx: TestApp;
    let service: StatementService;
    let bankId: string;
    let cardId: string;
    let received: StatementClosed[];
    let rowsSeenByHandler: number[];
    let unsubscribe: () => void;

    const newCard = async (name: string, archived = false): Promise<string> => {
        const card = await ctx.dataSource.getRepository(CreditCard).save({
            bankId,
            name,
            creditLimitCents: 500000,
            availableLimitCents: 500000,
            closingDay: 10,
            dueDay: 20,
            archivedAt: archived ? new Date() : null,
        });

        await ctx.dataSource.query(
            "UPDATE credit_cards SET created_at = '2026-01-15T12:00:00Z' WHERE id = $1",
            [card.id],
        );

        return card.id;
    };

    const closesOnOf = async (creditCardId: string): Promise<string[]> =>
        (
            await ctx.dataSource
                .getRepository(CreditCardStatement)
                .find({ where: { creditCardId }, order: { closesOn: 'ASC' } })
        ).map((row) => row.closesOn);

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        service = container.resolve(StatementService);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        bankId = (
            await ctx.dataSource
                .getRepository(Bank)
                .save({ febrabanCode: '260', name: 'Banco de Teste', archivedAt: null })
        ).id;
        cardId = await newCard('Cartão');

        received = [];
        rowsSeenByHandler = [];
        unsubscribe = container
            .resolve<DomainEventDispatcher>(DomainEventDispatcherSymbol)
            .subscribe<StatementClosed>(STATEMENT_CLOSED, async (event) => {
                received.push(event);

                const [row] = (await ctx.dataSource.query(
                    'SELECT count(*)::int AS n FROM credit_card_statements WHERE id = $1',
                    [event.payload.statementId],
                )) as [{ n: number }];
                rowsSeenByHandler.push(row.n);
            });
    });

    afterEach(async () => {
        unsubscribe();
        await ctx.dataSource.query('DELETE FROM credit_card_statements');
        await ctx.dataSource.query('DELETE FROM credit_cards');
        await ctx.dataSource.query('DELETE FROM banks');
    });

    it('AC-0013-05: registra os três ciclos passados em ordem, publica três StatementClosed depois do commit e a segunda chamada devolve 0', async () => {
        const registered = await service.closeDue(at('2026-04-11'), cardId);

        expect(registered).toBe(3);
        expect(await closesOnOf(cardId)).toEqual(['2026-02-10', '2026-03-10', '2026-04-10']);
        expect(received.map((event) => event.name)).toEqual([
            STATEMENT_CLOSED,
            STATEMENT_CLOSED,
            STATEMENT_CLOSED,
        ]);
        expect(received.map((event) => event.payload.closesOn)).toEqual([
            '2026-02-10',
            '2026-03-10',
            '2026-04-10',
        ]);
        expect(received[0]?.payload).toMatchObject({
            creditCardId: cardId,
            startsOn: '2026-01-11',
            dueOn: '2026-02-20',
            totalCents: 0,
            previousBalanceCents: 0,
            amountDueCents: 0,
        });
        // O handler só roda depois do commit e já enxerga a linha.
        expect(rowsSeenByHandler).toEqual([1, 1, 1]);

        expect(await service.closeDue(at('2026-04-11'), cardId)).toBe(0);
        expect(received).toHaveLength(3);
    });

    it('INV-0013-07: ciclo com closesOn igual a asOf ainda não fechou', async () => {
        expect(await service.closeDue(at('2026-04-10'), cardId)).toBe(2);
        expect(await closesOnOf(cardId)).toEqual(['2026-02-10', '2026-03-10']);
    });

    it('AC-0013-05, INV-0013-07: duas chamadas concorrentes registram cada ciclo uma vez só', async () => {
        const [first, second] = await Promise.all([
            service.closeDue(at('2026-04-11'), cardId),
            service.closeDue(at('2026-04-11'), cardId),
        ]);

        expect(first + second).toBe(3);
        expect(await closesOnOf(cardId)).toEqual(['2026-02-10', '2026-03-10', '2026-04-10']);
        expect(received).toHaveLength(3);
    }, 30000);

    it('sem creditCardId fecha todos os cartões, inclusive o arquivado', async () => {
        const archivedId = await newCard('Cartão arquivado', true);

        expect(await service.closeDue(at('2026-03-11'))).toBe(4);
        expect(await closesOnOf(cardId)).toEqual(['2026-02-10', '2026-03-10']);
        expect(await closesOnOf(archivedId)).toEqual(['2026-02-10', '2026-03-10']);
    });
});
