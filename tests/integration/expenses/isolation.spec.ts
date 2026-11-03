import { container } from '../../../src/container';
import {
    ExpenseRecurrenceServiceSymbol,
    ExpenseServiceSymbol,
    type ExpenseRecurrenceService,
    type ExpenseService,
} from '../../../src/expenses';
import { startApp, stopApp, type TestApp } from '../app.helper';
import {
    createTwoWorkspaces,
    type TwoWorkspaces,
    type WorkspaceSide,
} from '../helpers/workspaces.helper';

const SCHEMA = 'test_expenses_isolation';
const MISSING = '00000000-0000-4000-8000-000000000000';
/** Só `Date` é falsificado: o driver do Postgres precisa dos timers reais. */
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

type Space = WorkspaceSide & {
    bankAccountId: string;
    cardId: string;
    expenseId: string;
    seriesExpenseId: string;
    seriesId: string;
};

describe('despesas por espaço e tipos globais (spec 0021)', () => {
    let ctx: TestApp;
    let spaces: TwoWorkspaces;
    let a: Space;
    let b: Space;
    let typeId: string;
    let bankId: string;

    const expense = (space: WorkspaceSide, overrides: Record<string, unknown>) =>
        space.post('/expenses', {
            description: 'Compra',
            expenseTypeId: typeId,
            kind: 'VARIABLE',
            amountCents: 1000,
            occurredOn: '2026-03-10',
            status: 'OPEN',
            ...overrides,
        });

    const seed = async (side: WorkspaceSide, tag: string): Promise<Space> => {
        const accountId = (
            await side.post('/bank-accounts', {
                bankId,
                type: 'CHECKING',
                accountNumber: `1-${tag}`,
                description: `Conta ${tag}`,
                openingBalanceCents: 100000,
            })
        ).body.data.id as string;
        const cardId = (
            await side.post('/credit-cards', {
                bankId,
                name: `Cartão ${tag}`,
                creditLimitCents: 500000,
                closingDay: 28,
                dueDay: 5,
            })
        ).body.data.id as string;
        const plain = (await expense(side, { bankAccountId: accountId })).body.data[0].id as string;
        const series = (
            await expense(side, {
                kind: 'FIXED',
                description: `Aluguel ${tag}`,
                bankAccountId: accountId,
                occurredOn: '2026-10-10',
            })
        ).body.data[0];
        const seriesId = (
            await ctx.dataSource.query('SELECT recurrence_id AS id FROM expenses WHERE id = $1', [
                series.id,
            ])
        )[0].id as string;

        return Object.assign(side, {
            bankAccountId: accountId,
            cardId,
            expenseId: plain,
            seriesExpenseId: series.id as string,
            seriesId,
        });
    };

    const workspaceOf = async (id: string): Promise<string> =>
        (
            (await ctx.dataSource.query('SELECT workspace_id FROM expenses WHERE id = $1', [
                id,
            ])) as [{ workspace_id: string }]
        )[0].workspace_id;

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

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    beforeAll(async () => {
        spaces = await createTwoWorkspaces(ctx);

        // O espaço A também é admin da plataforma: escreve banco e tipo (catálogos globais).
        await ctx.dataSource.query('UPDATE users SET is_platform_admin = true WHERE id = $1', [
            spaces.a.userId,
        ]);

        bankId = (await spaces.a.post('/banks', { febrabanCode: '260', name: 'Nu Pagamentos' }))
            .body.data.id as string;
        typeId = (await spaces.a.post('/expense-types', { name: 'T-Isolamento' })).body.data
            .id as string;
    });

    beforeAll(async () => {
        a = await seed(spaces.a, 'A');
        b = await seed(spaces.b, 'B');
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    describe('AC-0021-12, INV-0021-03, ERR-0021-01: despesa de outro espaço é inexistente', () => {
        it('GET, PATCH, DELETE e as ações de B recebem o 404 EXPENSE_NOT_FOUND de A, igual ao id inexistente', async () => {
            const calls = (id: string) => [
                a.get(`/expenses/${id}`),
                a.patch(`/expenses/${id}`, { description: 'Invadida' }),
                a.patch(`/expenses/${id}?scope=following`, { description: 'Invadida' }),
                a.patch(`/expenses/${id}/status`, { status: 'PAID' }),
                a.patch(`/expenses/${id}/payment-method`, { bankAccountId: a.bankAccountId }),
                a.patch(`/expenses/${id}/reconciliation`, { reconciled: true }),
                a.delete(`/expenses/${id}`),
            ];
            const foreign = await Promise.all(calls(b.expenseId));
            const missing = await Promise.all(calls(MISSING));

            foreign.forEach((res, index) => {
                expect(res.status).toBe(404);
                expect(res.body.error.code).toBe('EXPENSE_NOT_FOUND');
                expect(res.body).toEqual(missing[index]?.body);
            });

            const untouched = await b.get(`/expenses/${b.expenseId}`);

            expect(untouched.status).toBe(200);
            expect(untouched.body.data.description).toBe('Compra');
            expect(untouched.body.data.status).toBe('OPEN');
        });

        it('a listagem de A não traz despesa de B, nem filtrando pelo id da conta de B', async () => {
            const own = await a.get('/expenses');
            const ids = own.body.data.map((row: { id: string }) => row.id);

            expect(ids).toContain(a.expenseId);
            expect(ids).not.toContain(b.expenseId);
            expect(ids).not.toContain(b.seriesExpenseId);

            const filtered = await a.get(`/expenses?bankAccountId=${b.bankAccountId}`);

            expect(filtered.status).toBe(200);
            expect(filtered.body.data).toEqual([]);
        });

        it('INV-0021-10: a resposta de despesa não devolve workspaceId', async () => {
            const res = await a.get(`/expenses/${a.expenseId}`);

            expect(res.body.data).not.toHaveProperty('workspaceId');
        });
    });

    describe('AC-0021-12, ERR-0021-01: série de outro espaço é inexistente', () => {
        it('GET e PATCH da série de B recebem EXPENSE_RECURRENCE_NOT_FOUND, e a lista de A a omite', async () => {
            const get = await a.get(`/expense-recurrences/${b.seriesId}`);
            const end = await a.patch(`/expense-recurrences/${b.seriesId}`, {
                endsOn: '2026-12-31',
            });
            const missing = await a.get(`/expense-recurrences/${MISSING}`);

            for (const res of [get, end]) {
                expect(res.status).toBe(404);
                expect(res.body.error.code).toBe('EXPENSE_RECURRENCE_NOT_FOUND');
            }
            expect(get.body).toEqual(missing.body);

            const list = await a.get('/expense-recurrences');
            const ids = list.body.data.map((row: { id: string }) => row.id);

            expect(ids).toContain(a.seriesId);
            expect(ids).not.toContain(b.seriesId);

            const stillOpen = await ctx.dataSource.query(
                'SELECT ends_on FROM expense_recurrences WHERE id = $1',
                [b.seriesId],
            );

            expect(stillOpen[0].ends_on).toBeNull();
        });
    });

    describe('AC-0021-12, ERR-0021-02: conta ou cartão de outro espaço no corpo é inexistente', () => {
        it('criar despesa de A com conta ou cartão de B responde como o id inexistente', async () => {
            const cases = [
                ['bankAccountId', b.bankAccountId, 'BANK_ACCOUNT_NOT_FOUND'],
                ['creditCardId', b.cardId, 'CREDIT_CARD_NOT_FOUND'],
            ] as const;

            for (const [field, foreignId, code] of cases) {
                const foreign = await expense(a, { [field]: foreignId });
                const missing = await expense(a, { [field]: MISSING });

                expect(foreign.status).toBe(404);
                expect(foreign.body.error.code).toBe(code);
                expect(foreign.body).toEqual(missing.body);
            }
        });

        it('criar série FIXED de A com conta de B responde BANK_ACCOUNT_NOT_FOUND e nada é gravado', async () => {
            const before = await a.get('/expense-recurrences');
            const res = await expense(a, {
                kind: 'FIXED',
                bankAccountId: b.bankAccountId,
                occurredOn: '2026-10-10',
            });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
            expect((await a.get('/expense-recurrences')).body.data).toHaveLength(
                before.body.data.length,
            );
        });

        it('trocar a forma de pagamento de A para conta ou cartão de B responde como inexistente', async () => {
            const toAccount = await a.patch(`/expenses/${a.expenseId}/payment-method`, {
                bankAccountId: b.bankAccountId,
            });
            const toCard = await a.patch(`/expenses/${a.expenseId}/payment-method`, {
                creditCardId: b.cardId,
            });

            expect(toAccount.status).toBe(404);
            expect(toAccount.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
            expect(toCard.status).toBe(404);
            expect(toCard.body.error.code).toBe('CREDIT_CARD_NOT_FOUND');
        });
    });

    describe('AC-0021-17, INV-0021-06: as rotinas diárias percorrem todos os espaços', () => {
        const expenses = (): ExpenseService => container.resolve(ExpenseServiceSymbol);
        const recurrences = (): ExpenseRecurrenceService =>
            container.resolve(ExpenseRecurrenceServiceSymbol);

        it('expenses.extend-recurrences cria as ocorrências de cada série no espaço da série', async () => {
            const countOf = async (seriesId: string): Promise<number> =>
                Number(
                    (
                        await ctx.dataSource.query(
                            'SELECT count(*) AS n FROM expenses WHERE recurrence_id = $1',
                            [seriesId],
                        )
                    )[0].n,
                );
            const beforeA = await countOf(a.seriesId);
            const beforeB = await countOf(b.seriesId);

            const created = await atDate('2028-06-15', () =>
                recurrences().extend(new Date('2028-06-15T15:00:00Z')),
            );

            expect(created).toBeGreaterThan(0);
            expect(await countOf(a.seriesId)).toBeGreaterThan(beforeA);
            expect(await countOf(b.seriesId)).toBeGreaterThan(beforeB);

            const stray = await ctx.dataSource.query(
                `SELECT count(*) AS n FROM expenses e
                   JOIN expense_recurrences r ON r.id = e.recurrence_id
                  WHERE e.workspace_id <> r.workspace_id`,
            );

            expect(Number(stray[0].n)).toBe(0);
            expect(await workspaceOf(a.seriesExpenseId)).toBe(a.workspaceId);
            expect(await workspaceOf(b.seriesExpenseId)).toBe(b.workspaceId);
        });

        it('expenses.promote-recurrences promove a FORECAST de A e de B, cada uma no seu espaço', async () => {
            const promoted = await atDate('2028-06-15', () =>
                recurrences().promote(new Date('2028-06-15T15:00:00Z')),
            );
            const rows = (await ctx.dataSource.query(
                `SELECT e.workspace_id AS ws, r.workspace_id AS series_ws, e.status
                   FROM expenses e JOIN expense_recurrences r ON r.id = e.recurrence_id
                  WHERE e.occurred_on <= '2028-06-15'`,
            )) as { ws: string; series_ws: string; status: string }[];

            expect(promoted).toBeGreaterThan(0);
            expect(rows.some((row) => row.ws === a.workspaceId)).toBe(true);
            expect(rows.some((row) => row.ws === b.workspaceId)).toBe(true);
            expect(rows.every((row) => row.ws === row.series_ws)).toBe(true);
            expect(rows.every((row) => row.status !== 'FORECAST')).toBe(true);
        });

        it('expenses.mark-overdue vence a despesa OPEN de conta de A e de B e mantém o espaço de cada uma', async () => {
            const changed = await expenses().markOverdue(new Date('2028-06-15T15:00:00Z'));

            expect(changed).toBeGreaterThanOrEqual(2);
            for (const space of [a, b]) {
                const res = await space.get(`/expenses/${space.expenseId}`);

                expect(res.body.data.status).toBe('OVERDUE');
                expect(await workspaceOf(space.expenseId)).toBe(space.workspaceId);
            }
        });
    });

    describe('AC-0021-18, INV-0021-08: tipos de despesa são catálogo global', () => {
        it('um membro ADMIN que não é admin da plataforma lê o catálogo e recebe 403 FORBIDDEN ao escrever', async () => {
            expect((await b.get('/expense-types')).status).toBe(200);

            const writes = await Promise.all([
                b.post('/expense-types', { name: 'T-Intruso' }),
                b.patch(`/expense-types/${typeId}`, { name: 'T-Intruso' }),
                b.post(`/expense-types/${typeId}/archive`),
                b.delete(`/expense-types/${typeId}/archive`),
            ]);

            for (const res of writes) {
                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe('FORBIDDEN');
            }
        });

        it('o admin da plataforma escreve, e A e B veem a mesma lista', async () => {
            const created = await a.post('/expense-types', { name: 'T-Global' });

            expect(created.status).toBe(201);
            expect(
                (await a.patch(`/expense-types/${created.body.data.id}`, { name: 'T-Global2' }))
                    .status,
            ).toBe(200);

            const listA = await a.get('/expense-types');
            const listB = await b.get('/expense-types');

            expect(listA.status).toBe(200);
            expect(listB.body.data).toEqual(listA.body.data);
            expect(listB.body.data.map((row: { name: string }) => row.name)).toContain('T-Global2');
        });
    });
});
