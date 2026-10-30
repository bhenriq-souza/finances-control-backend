import { container } from '../../../src/container';
import { StatementService } from '../../../src/statements';
import { startApp, stopApp, type TestApp } from '../app.helper';
import { insertDomainRows, type DomainRows } from '../helpers/domain-rows.helper';
import { createTwoWorkspaces, type TwoWorkspaces } from '../helpers/workspaces.helper';

const SCHEMA = 'test_statements_isolation';
const MISSING = '00000000-0000-4000-8000-000000000000';

/** The 10th (closing day of the fixture cards) most recently passed, so no later cycle has closed. */
function lastClosing(): { startsOn: string; closesOn: string; dueOn: string } {
    const now = new Date();
    const month = now.getUTCDate() > 12 ? now.getUTCMonth() : now.getUTCMonth() - 1;
    const closes = new Date(Date.UTC(now.getUTCFullYear(), month, 10));
    const starts = new Date(Date.UTC(closes.getUTCFullYear(), closes.getUTCMonth() - 1, 11));
    const due = new Date(Date.UTC(closes.getUTCFullYear(), closes.getUTCMonth(), 20));
    const iso = (date: Date) => date.toISOString().slice(0, 10);

    return { startsOn: iso(starts), closesOn: iso(closes), dueOn: iso(due) };
}

describe('faturas, pagamentos e estornos por espaço (spec 0021)', () => {
    let ctx: TestApp;
    let spaces: TwoWorkspaces;
    let a: DomainRows;
    let b: DomainRows;

    const scalar = async (sql: string, params: unknown[] = []): Promise<string | null> =>
        ((await ctx.dataSource.query(sql, params)) as [{ v: string | null }])[0].v;

    const balanceOfB = () =>
        scalar('SELECT current_balance_cents AS v FROM bank_accounts WHERE id = $1', [b.accountId]);

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        spaces = await createTwoWorkspaces(ctx);

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

    describe('faturas', () => {
        it('AC-0021-14, INV-0021-03: GET /statements/:id de B por A é STATEMENT_NOT_FOUND, igual ao id inexistente', async () => {
            const foreign = await spaces.a.get(`/statements/${b.statementId}`);
            const missing = await spaces.a.get(`/statements/${MISSING}`);

            expect(foreign.status).toBe(404);
            expect(foreign.body.error.code).toBe('STATEMENT_NOT_FOUND');
            expect(foreign.body.error.message).toBe(missing.body.error.message);
            expect((await spaces.b.get(`/statements/${b.statementId}`)).status).toBe(200);
        });

        it('AC-0021-14, ERR-0021-01: GET /statements e /statements/current com cartão de B por A são CREDIT_CARD_NOT_FOUND', async () => {
            for (const path of [
                `/statements?creditCardId=${b.cardId}`,
                `/statements/current?creditCardId=${b.cardId}`,
            ]) {
                const foreign = await spaces.a.get(path);

                expect(foreign.status).toBe(404);
                expect(foreign.body.error.code).toBe('CREDIT_CARD_NOT_FOUND');
            }
        });

        it('AC-0021-14, INV-0021-03: a lista de A não contém fatura de B', async () => {
            const res = await spaces.a.get(`/statements?creditCardId=${a.cardId}`);

            expect(res.status).toBe(200);
            expect(JSON.stringify(res.body)).not.toContain(b.statementId);
        });

        it('AC-0021-14, INV-0021-03: PATCH /statements/:id de B por A é STATEMENT_NOT_FOUND e nada muda', async () => {
            const res = await spaces.a.patch(`/statements/${b.statementId}`, {
                minimumPaymentCents: 100,
            });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('STATEMENT_NOT_FOUND');
            expect(
                await scalar(
                    'SELECT minimum_payment_cents AS v FROM credit_card_statements WHERE id = $1',
                    [b.statementId],
                ),
            ).toBeNull();
        });
    });

    describe('pagamentos', () => {
        it('AC-0021-14, INV-0021-03: pagar fatura de B por A é STATEMENT_NOT_FOUND e não move saldo nem pagamentos', async () => {
            const before = await scalar('SELECT count(*) AS v FROM credit_card_statement_payments');
            const res = await spaces.a.post(`/statements/${b.statementId}/payments`, {
                amountCents: 1,
                bankAccountId: a.accountId,
            });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('STATEMENT_NOT_FOUND');
            expect(await scalar('SELECT count(*) AS v FROM credit_card_statement_payments')).toBe(
                before,
            );
            expect(await balanceOfB()).toBe('100.00');
        });

        it('AC-0021-14, INV-0021-03: desfazer pagamento de fatura de B por A é STATEMENT_NOT_FOUND e o pagamento fica', async () => {
            const res = await spaces.a.delete(
                `/statements/${b.statementId}/payments/${b.paymentId}`,
            );

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('STATEMENT_NOT_FOUND');
            expect(
                await scalar(
                    'SELECT count(*) AS v FROM credit_card_statement_payments WHERE id = $1',
                    [b.paymentId],
                ),
            ).toBe('1');
        });

        it('AC-0021-14, ERR-0021-01: pagar e desfazer antecipado com cartão de B por A são CREDIT_CARD_NOT_FOUND', async () => {
            const pay = await spaces.a.post('/statements/current/payments', {
                creditCardId: b.cardId,
                amountCents: 1,
                bankAccountId: a.accountId,
            });
            const undo = await spaces.a.delete(
                `/statements/current/payments/${b.paymentId}?creditCardId=${b.cardId}`,
            );

            expect(pay.status).toBe(404);
            expect(pay.body.error.code).toBe('CREDIT_CARD_NOT_FOUND');
            expect(undo.status).toBe(404);
            expect(undo.body.error.code).toBe('CREDIT_CARD_NOT_FOUND');
        });

        it('AC-0021-14, ERR-0021-02: pagar fatura de A com conta de B é BANK_ACCOUNT_NOT_FOUND, e com conta de A paga', async () => {
            const { startsOn, closesOn, dueOn } = lastClosing();
            const [card] = (await ctx.dataSource.query(
                `INSERT INTO credit_cards (workspace_id, bank_id, name, credit_limit_cents,
                    available_limit_cents, closing_day, due_day)
                 SELECT workspace_id, bank_id, 'Cartão pagamento', 1000, 1000, 10, 20
                   FROM credit_cards WHERE id = $1 RETURNING id`,
                [a.cardId],
            )) as [{ id: string }];
            const [statement] = (await ctx.dataSource.query(
                `INSERT INTO credit_card_statements (workspace_id, credit_card_id, starts_on,
                    closes_on, due_on, status, previous_balance_cents, closed_at)
                 VALUES ($1, $2, $3, $4, $5, 'CLOSED', 50, now()) RETURNING id`,
                [spaces.a.workspaceId, card.id, startsOn, closesOn, dueOn],
            )) as [{ id: string }];
            const path = `/statements/${statement.id}/payments`;

            const foreign = await spaces.a.post(path, {
                amountCents: 100,
                bankAccountId: b.accountId,
            });

            expect(foreign.status).toBe(404);
            expect(foreign.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
            expect(await balanceOfB()).toBe('100.00');

            const own = await spaces.a.post(path, { amountCents: 100, bankAccountId: a.accountId });

            expect(own.status).toBe(201);
            expect(
                await scalar(
                    'SELECT workspace_id AS v FROM credit_card_statement_payments WHERE statement_id = $1',
                    [statement.id],
                ),
            ).toBe(spaces.a.workspaceId);
        });
    });

    describe('estornos', () => {
        const refundPath = (id: string) => `/credit-card-refunds/${id}`;

        it('AC-0021-14, INV-0021-03: GET, PATCH e DELETE de estorno de B por A são CREDIT_CARD_REFUND_NOT_FOUND', async () => {
            const responses = [
                await spaces.a.get(refundPath(b.refundId)),
                await spaces.a.patch(refundPath(b.refundId), { description: 'x' }),
                await spaces.a.delete(refundPath(b.refundId)),
            ];

            for (const res of responses) {
                expect(res.status).toBe(404);
                expect(res.body.error.code).toBe('CREDIT_CARD_REFUND_NOT_FOUND');
            }
            expect(
                await scalar('SELECT description AS v FROM credit_card_refunds WHERE id = $1', [
                    b.refundId,
                ]),
            ).toBe('Estorno');
            expect(
                await scalar('SELECT available_limit_cents AS v FROM credit_cards WHERE id = $1', [
                    b.cardId,
                ]),
            ).toBe('1000.00');
        });

        it('AC-0021-14, INV-0021-03: a lista de estornos de A não contém o de B, nem filtrando pelo cartão de B', async () => {
            const all = await spaces.a.get('/credit-card-refunds');
            const byCard = await spaces.a.get(`/credit-card-refunds?creditCardId=${b.cardId}`);

            expect(all.status).toBe(200);
            expect(JSON.stringify(all.body)).toContain(a.refundId);
            expect(JSON.stringify(all.body)).not.toContain(b.refundId);
            expect(byCard.body.data).toEqual([]);
        });

        it('AC-0021-14, ERR-0021-02: criar estorno com cartão de B é CREDIT_CARD_NOT_FOUND, e com despesa de B é EXPENSE_NOT_FOUND', async () => {
            const card = await spaces.a.post('/credit-card-refunds', {
                creditCardId: b.cardId,
                description: 'Estorno',
                amountCents: 1,
                occurredOn: '2026-10-01',
            });
            const expense = await spaces.a.post('/credit-card-refunds', {
                creditCardId: a.cardId,
                expenseId: b.cardExpenseId,
                description: 'Estorno',
                amountCents: 1,
                occurredOn: '2026-10-01',
            });

            expect(card.status).toBe(404);
            expect(card.body.error.code).toBe('CREDIT_CARD_NOT_FOUND');
            expect(expense.status).toBe(404);
            expect(expense.body.error.code).toBe('EXPENSE_NOT_FOUND');
        });
    });

    describe('jobs', () => {
        const count = async (cardId: string): Promise<number> =>
            Number(
                await scalar(
                    'SELECT count(*) AS v FROM credit_card_statements WHERE credit_card_id = $1',
                    [cardId],
                ),
            );

        it('AC-0021-17, INV-0021-06: statements.close-due fecha as faturas de cada espaço no próprio espaço', async () => {
            const beforeA = await count(a.cardId);
            const beforeB = await count(b.cardId);

            const registered = await container
                .resolve(StatementService)
                .closeDue(new Date('2027-06-15T12:00:00.000Z'));

            expect(registered).toBeGreaterThan(0);
            expect(await count(a.cardId)).toBeGreaterThan(beforeA);
            expect(await count(b.cardId)).toBeGreaterThan(beforeB);
            expect(
                await scalar(`SELECT count(*) AS v FROM credit_card_statements s
                    JOIN credit_cards c ON c.id = s.credit_card_id
                   WHERE s.workspace_id <> c.workspace_id`),
            ).toBe('0');
        });
    });
});
