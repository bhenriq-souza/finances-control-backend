import 'reflect-metadata';
import type { RouteDef } from '@bhs-dev/typescript-common-types';
import type { Test } from 'supertest';

import { apiModules } from '../../../src/api.config';
import { startApp, stopApp, type TestApp } from '../app.helper';
import { insertDomainRows, type DomainRows } from '../helpers/domain-rows.helper';
import {
    createTwoWorkspaces,
    type TwoWorkspaces,
    type WorkspaceSide,
} from '../helpers/workspaces.helper';

const SCHEMA = 'test_routes_isolation';

/**
 * As rotas registradas, lidas das próprias classes de rota (mesma técnica do
 * `tests/openapi.spec.ts`): cada classe é instanciada com dependências inertes só
 * para chamar `routes()`.
 */
const inert: unknown = new Proxy(() => inert, { get: () => inert, apply: () => inert });

const registeredRoutes: string[] = apiModules.flatMap(({ path: prefix, route }) => {
    if (!prefix || !route) return [];

    const args = Array.from({ length: route.clazz.length }, () => inert);
    const routes = new route.clazz(...args) as { routes(): RouteDef[] };

    return routes
        .routes()
        .map(({ method, path }) => `${method.toUpperCase()} ${prefix}${path === '/' ? '' : path}`);
});

type Ctx = {
    a: WorkspaceSide;
    b: DomainRows;
    a2: DomainRows;
    bankId: string;
    expenseTypeId: string;
    earningTypeId: string;
};

/** A chama a rota com id(s) de B e espera `404` com o código do módulo (ERR-0021-01/02). */
type ForeignCase = { foreign: (ctx: Ctx) => Test; code: string };
/** A lista as próprias linhas; nenhum id de B pode aparecer (INV-0021-03). */
type ListCase = { list: string };
/** Fora do escopo da suíte, com o motivo e onde é coberta. */
type ExemptCase = { exempt: string };

type RouteCase = ForeignCase | ListCase | ExemptCase;

const PLATFORM = 'catálogo global, sem espaço (INV-0021-08); coberto nos isolation.spec de ';
const IDENTITY =
    'rota de usuário/espaço, sem dados de domínio; coberta em identity/workspaces.spec';

const cases: Record<string, RouteCase> = {
    'GET /health': { exempt: 'sem autenticação nem dados de domínio' },
    'GET /health/ready': { exempt: 'sem autenticação nem dados de domínio' },

    // identity
    'GET /users/me': { exempt: IDENTITY },
    'PUT /users/me/avatar': { exempt: IDENTITY },
    'GET /users/me/avatar': { exempt: IDENTITY },
    'DELETE /users/me/avatar': { exempt: IDENTITY },
    'GET /users': { exempt: IDENTITY },
    'PATCH /users/:id/profile': { exempt: IDENTITY },
    'DELETE /users/:id/profile': { exempt: IDENTITY },
    'GET /workspaces': { exempt: IDENTITY },
    'PATCH /workspaces/:id': { exempt: IDENTITY },

    // catálogos globais
    'GET /banks': { exempt: `${PLATFORM}accounts` },
    'POST /banks': { exempt: `${PLATFORM}accounts` },
    'PATCH /banks/:id': { exempt: `${PLATFORM}accounts` },
    'POST /banks/:id/archive': { exempt: `${PLATFORM}accounts` },
    'DELETE /banks/:id/archive': { exempt: `${PLATFORM}accounts` },
    'GET /expense-types': { exempt: `${PLATFORM}expenses` },
    'POST /expense-types': { exempt: `${PLATFORM}expenses` },
    'PATCH /expense-types/:id': { exempt: `${PLATFORM}expenses` },
    'POST /expense-types/:id/archive': { exempt: `${PLATFORM}expenses` },
    'DELETE /expense-types/:id/archive': { exempt: `${PLATFORM}expenses` },
    'GET /earning-types': { exempt: `${PLATFORM}earnings` },
    'POST /earning-types': { exempt: `${PLATFORM}earnings` },
    'PATCH /earning-types/:id': { exempt: `${PLATFORM}earnings` },
    'POST /earning-types/:id/archive': { exempt: `${PLATFORM}earnings` },
    'DELETE /earning-types/:id/archive': { exempt: `${PLATFORM}earnings` },

    // bank-accounts
    'GET /bank-accounts': { list: '/bank-accounts' },
    'GET /bank-accounts/:id': {
        foreign: ({ a, b }) => a.get(`/bank-accounts/${b.accountId}`),
        code: 'BANK_ACCOUNT_NOT_FOUND',
    },
    'POST /bank-accounts': {
        foreign: () => {
            throw new Error('unused');
        },
        code: '',
    },
    'PATCH /bank-accounts/:id': {
        foreign: ({ a, b }) => a.patch(`/bank-accounts/${b.accountId}`, { description: 'x' }),
        code: 'BANK_ACCOUNT_NOT_FOUND',
    },
    'POST /bank-accounts/:id/archive': {
        foreign: ({ a, b }) => a.post(`/bank-accounts/${b.accountId}/archive`),
        code: 'BANK_ACCOUNT_NOT_FOUND',
    },
    'DELETE /bank-accounts/:id/archive': {
        foreign: ({ a, b }) => a.delete(`/bank-accounts/${b.accountId}/archive`),
        code: 'BANK_ACCOUNT_NOT_FOUND',
    },

    // credit-cards
    'GET /credit-cards': { list: '/credit-cards' },
    'GET /credit-cards/:id': {
        foreign: ({ a, b }) => a.get(`/credit-cards/${b.cardId}`),
        code: 'CREDIT_CARD_NOT_FOUND',
    },
    'POST /credit-cards': {
        foreign: ({ a, b, bankId }) =>
            a.post('/credit-cards', {
                bankId,
                name: 'X',
                creditLimitCents: 100,
                closingDay: 10,
                dueDay: 20,
                paymentBankAccountId: b.accountId,
            }),
        code: 'BANK_ACCOUNT_NOT_FOUND',
    },
    'PATCH /credit-cards/:id': {
        foreign: ({ a, b }) => a.patch(`/credit-cards/${b.cardId}`, { name: 'x' }),
        code: 'CREDIT_CARD_NOT_FOUND',
    },
    'POST /credit-cards/:id/archive': {
        foreign: ({ a, b }) => a.post(`/credit-cards/${b.cardId}/archive`),
        code: 'CREDIT_CARD_NOT_FOUND',
    },
    'DELETE /credit-cards/:id/archive': {
        foreign: ({ a, b }) => a.delete(`/credit-cards/${b.cardId}/archive`),
        code: 'CREDIT_CARD_NOT_FOUND',
    },

    // bank-transfers
    'GET /bank-transfers': { list: '/bank-transfers' },
    'GET /bank-transfers/:id': {
        foreign: ({ a, b }) => a.get(`/bank-transfers/${b.transferId}`),
        code: 'BANK_TRANSFER_NOT_FOUND',
    },
    'PATCH /bank-transfers/:id': {
        foreign: ({ a, b }) => a.patch(`/bank-transfers/${b.transferId}`, { description: 'x' }),
        code: 'BANK_TRANSFER_NOT_FOUND',
    },
    'DELETE /bank-transfers/:id': {
        foreign: ({ a, b }) => a.delete(`/bank-transfers/${b.transferId}`),
        code: 'BANK_TRANSFER_NOT_FOUND',
    },
    'POST /bank-transfers': {
        foreign: ({ a, a2, b }) =>
            a.post('/bank-transfers', {
                fromBankAccountId: a2.accountId,
                toBankAccountId: b.accountId,
                amountCents: 1,
                occurredOn: '2026-03-12',
                description: 'x',
            }),
        code: 'BANK_ACCOUNT_NOT_FOUND',
    },
    'PATCH /bank-transfers/:id/status': {
        foreign: ({ a, b }) =>
            a.patch(`/bank-transfers/${b.transferId}/status`, { status: 'COMPLETED' }),
        code: 'BANK_TRANSFER_NOT_FOUND',
    },

    // expenses
    'GET /expenses': { list: '/expenses' },
    'GET /expenses/:id': {
        foreign: ({ a, b }) => a.get(`/expenses/${b.expenseId}`),
        code: 'EXPENSE_NOT_FOUND',
    },
    'PATCH /expenses/:id': {
        foreign: ({ a, b }) => a.patch(`/expenses/${b.expenseId}`, { description: 'x' }),
        code: 'EXPENSE_NOT_FOUND',
    },
    'DELETE /expenses/:id': {
        foreign: ({ a, b }) => a.delete(`/expenses/${b.expenseId}`),
        code: 'EXPENSE_NOT_FOUND',
    },
    'POST /expenses': {
        foreign: ({ a, b, expenseTypeId }) =>
            a.post('/expenses', {
                description: 'x',
                expenseTypeId,
                kind: 'VARIABLE',
                amountCents: 10,
                occurredOn: '2026-03-10',
                status: 'OPEN',
                bankAccountId: b.accountId,
            }),
        code: 'BANK_ACCOUNT_NOT_FOUND',
    },
    'PATCH /expenses/:id/status': {
        foreign: ({ a, b }) => a.patch(`/expenses/${b.expenseId}/status`, { status: 'PAID' }),
        code: 'EXPENSE_NOT_FOUND',
    },
    'PATCH /expenses/:id/payment-method': {
        foreign: ({ a, b }) =>
            a.patch(`/expenses/${b.expenseId}/payment-method`, { bankAccountId: b.accountId }),
        code: 'EXPENSE_NOT_FOUND',
    },
    'PATCH /expenses/:id/reconciliation': {
        foreign: ({ a, b }) =>
            a.patch(`/expenses/${b.expenseId}/reconciliation`, { reconciled: true }),
        code: 'EXPENSE_NOT_FOUND',
    },

    // expense-recurrences
    'GET /expense-recurrences': { list: '/expense-recurrences' },
    'GET /expense-recurrences/:id': {
        foreign: ({ a, b }) => a.get(`/expense-recurrences/${b.expenseRecurrenceId}`),
        code: 'EXPENSE_RECURRENCE_NOT_FOUND',
    },
    'PATCH /expense-recurrences/:id': {
        foreign: ({ a, b }) =>
            a.patch(`/expense-recurrences/${b.expenseRecurrenceId}`, { endsOn: '2026-12-31' }),
        code: 'EXPENSE_RECURRENCE_NOT_FOUND',
    },

    // earnings
    'GET /earnings': { list: '/earnings' },
    'GET /earnings/:id': {
        foreign: ({ a, b }) => a.get(`/earnings/${b.earningId}`),
        code: 'EARNING_NOT_FOUND',
    },
    'PATCH /earnings/:id': {
        foreign: ({ a, b }) => a.patch(`/earnings/${b.earningId}`, { description: 'x' }),
        code: 'EARNING_NOT_FOUND',
    },
    'DELETE /earnings/:id': {
        foreign: ({ a, b }) => a.delete(`/earnings/${b.earningId}`),
        code: 'EARNING_NOT_FOUND',
    },
    'POST /earnings': {
        foreign: ({ a, b, earningTypeId }) =>
            a.post('/earnings', {
                description: 'x',
                earningTypeId,
                kind: 'VARIABLE',
                amountCents: 10,
                occurredOn: '2026-03-10',
                status: 'OPEN',
                bankAccountId: b.accountId,
            }),
        code: 'BANK_ACCOUNT_NOT_FOUND',
    },
    'PATCH /earnings/:id/status': {
        foreign: ({ a, b }) => a.patch(`/earnings/${b.earningId}/status`, { status: 'RECEIVED' }),
        code: 'EARNING_NOT_FOUND',
    },

    // earning-recurrences
    'GET /earning-recurrences': { list: '/earning-recurrences' },
    'GET /earning-recurrences/:id': {
        foreign: ({ a, b }) => a.get(`/earning-recurrences/${b.earningRecurrenceId}`),
        code: 'EARNING_RECURRENCE_NOT_FOUND',
    },
    'PATCH /earning-recurrences/:id': {
        foreign: ({ a, b }) =>
            a.patch(`/earning-recurrences/${b.earningRecurrenceId}`, { endsOn: '2026-12-31' }),
        code: 'EARNING_RECURRENCE_NOT_FOUND',
    },

    // statements
    'GET /statements': { list: '/statements?creditCardId=' },
    'GET /statements/current': {
        foreign: ({ a, b }) => a.get(`/statements/current?creditCardId=${b.cardId}`),
        code: 'CREDIT_CARD_NOT_FOUND',
    },
    'GET /statements/:id': {
        foreign: ({ a, b }) => a.get(`/statements/${b.statementId}`),
        code: 'STATEMENT_NOT_FOUND',
    },
    'PATCH /statements/:id': {
        foreign: ({ a, b }) =>
            a.patch(`/statements/${b.statementId}`, { minimumPaymentCents: 100 }),
        code: 'STATEMENT_NOT_FOUND',
    },
    'POST /statements/current/payments': {
        foreign: ({ a, b }) =>
            a.post('/statements/current/payments', {
                creditCardId: b.cardId,
                amountCents: 1,
                bankAccountId: b.accountId,
            }),
        code: 'CREDIT_CARD_NOT_FOUND',
    },
    'DELETE /statements/current/payments/:paymentId': {
        foreign: ({ a, b }) =>
            a.delete(`/statements/current/payments/${b.paymentId}?creditCardId=${b.cardId}`),
        code: 'CREDIT_CARD_NOT_FOUND',
    },
    'POST /statements/:id/payments': {
        foreign: ({ a, b }) =>
            a.post(`/statements/${b.statementId}/payments`, {
                amountCents: 1,
                bankAccountId: b.accountId,
            }),
        code: 'STATEMENT_NOT_FOUND',
    },
    'DELETE /statements/:id/payments/:paymentId': {
        foreign: ({ a, b }) => a.delete(`/statements/${b.statementId}/payments/${b.paymentId}`),
        code: 'STATEMENT_NOT_FOUND',
    },

    // credit-card-refunds
    'GET /credit-card-refunds': { list: '/credit-card-refunds' },
    'GET /credit-card-refunds/:id': {
        foreign: ({ a, b }) => a.get(`/credit-card-refunds/${b.refundId}`),
        code: 'CREDIT_CARD_REFUND_NOT_FOUND',
    },
    'PATCH /credit-card-refunds/:id': {
        foreign: ({ a, b }) => a.patch(`/credit-card-refunds/${b.refundId}`, { description: 'x' }),
        code: 'CREDIT_CARD_REFUND_NOT_FOUND',
    },
    'DELETE /credit-card-refunds/:id': {
        foreign: ({ a, b }) => a.delete(`/credit-card-refunds/${b.refundId}`),
        code: 'CREDIT_CARD_REFUND_NOT_FOUND',
    },
    'POST /credit-card-refunds': {
        foreign: ({ a, b }) =>
            a.post('/credit-card-refunds', {
                creditCardId: b.cardId,
                expenseId: b.cardExpenseId,
                description: 'x',
                amountCents: 1,
                occurredOn: '2026-03-02',
            }),
        code: 'CREDIT_CARD_NOT_FOUND',
    },

    // reports
    'GET /reports/balance': {
        foreign: ({ a, b }) =>
            a.get(`/reports/balance?from=2026-01&to=2026-12&bankAccountId=${b.accountId}`),
        code: 'BANK_ACCOUNT_NOT_FOUND',
    },
    'GET /reports/expenses-by-type': {
        list: '/reports/expenses-by-type?from=2026-01&to=2026-12',
    },
    'GET /reports/earnings-by-type': {
        list: '/reports/earnings-by-type?from=2026-01&to=2026-12',
    },
    'GET /reports/cash-flow': {
        foreign: ({ a, b }) =>
            a.get(`/reports/cash-flow?bankAccountId=${b.accountId}&from=2026-01&to=2026-12`),
        code: 'BANK_ACCOUNT_NOT_FOUND',
    },
    'GET /reports/account-movements': {
        foreign: ({ a, b }) =>
            a.get(
                `/reports/account-movements?bankAccountId=${b.accountId}&from=2026-01-01&to=2026-12-31`,
            ),
        code: 'BANK_ACCOUNT_NOT_FOUND',
    },
};

describe('isolamento por rota entre espaços (spec 0021)', () => {
    let ctx: TestApp;
    let spaces: TwoWorkspaces;
    let a: DomainRows;
    let a2: DomainRows;
    let b: DomainRows;
    let bankId: string;
    let expenseTypeId: string;
    let earningTypeId: string;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        spaces = await createTwoWorkspaces(ctx);

        const [bank] = (await ctx.dataSource.query(
            "INSERT INTO banks (febraban_code, name) VALUES ('260', 'Nu') RETURNING id",
        )) as [{ id: string }];

        bankId = bank.id;
        expenseTypeId = (
            (await ctx.dataSource.query('SELECT id FROM expense_types LIMIT 1')) as [{ id: string }]
        )[0].id;
        earningTypeId = (
            (await ctx.dataSource.query('SELECT id FROM earning_types LIMIT 1')) as [{ id: string }]
        )[0].id;
        a = await insertDomainRows(ctx.dataSource, {
            bankId: bank.id,
            workspaceId: spaces.a.workspaceId,
            tag: 'a',
        });
        a2 = a;
        b = await insertDomainRows(ctx.dataSource, {
            bankId: bank.id,
            workspaceId: spaces.b.workspaceId,
            tag: 'b',
        });
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    it('AC-0021-20: toda rota registrada tem caso na suíte, e todo caso corresponde a uma rota registrada', () => {
        expect(registeredRoutes.length).toBeGreaterThan(0);
        expect(registeredRoutes.filter((key) => !(key in cases))).toEqual([]);
        expect(Object.keys(cases).filter((key) => !registeredRoutes.includes(key))).toEqual([]);
    });

    it('AC-0021-20: toda exceção declara o motivo', () => {
        for (const value of Object.values(cases)) {
            if ('exempt' in value) expect(value.exempt.length).toBeGreaterThan(10);
        }
    });

    const entries = Object.entries(cases);
    const foreignEntries = entries.filter(
        (entry): entry is [string, ForeignCase] => 'foreign' in entry[1] && entry[1].code !== '',
    );
    const listEntries = entries.filter((entry): entry is [string, ListCase] => 'list' in entry[1]);

    it.each(foreignEntries)(
        'AC-0021-20, INV-0021-03, ERR-0021-01, ERR-0021-02: %s com id de B por A é 404',
        async (_key, routeCase) => {
            const res = await routeCase.foreign({
                a: spaces.a,
                b,
                a2,
                bankId,
                expenseTypeId,
                earningTypeId,
            });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe(routeCase.code);
            expect(JSON.stringify(res.body)).not.toContain(spaces.b.workspaceId);
        },
    );

    it.each(listEntries)(
        'AC-0021-20, INV-0021-03, INV-0021-10: %s de A não contém id de B nem workspaceId',
        async (_key, routeCase) => {
            const res = await spaces.a.get(
                routeCase.list.replace('creditCardId=', `creditCardId=${a.cardId}`),
            );
            const text = JSON.stringify(res.body);

            expect(res.status).toBe(200);
            for (const id of Object.values(b)) expect(text).not.toContain(id);
            expect(text).not.toContain('workspaceId');
        },
    );

    it('AC-0021-20: as linhas de A existem e aparecem na própria listagem', async () => {
        const res = await spaces.a.get('/bank-accounts');

        expect(JSON.stringify(res.body)).toContain(a.accountId);
    });
});
