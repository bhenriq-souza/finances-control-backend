import request from 'supertest';

import { container } from '../../../src/container';
import { RealizedBalanceService, RealizedBalanceServiceSymbol } from '../../../src/reporting';
import { startApp, type TestApp } from '../app.helper';

export const ADMIN = 'Bearer uid-admin';

export type ReportingFixture = {
    ctx: TestApp;
    accountId: string;
    cardId: string;
    expenseTypeId: string;
    earningTypeId: string;
};

export const realizedBalanceService = (): RealizedBalanceService =>
    container.resolve<RealizedBalanceService>(RealizedBalanceServiceSymbol);

type Created = { id?: string | null };

/** Creation routes answer with one resource, or a list (installment-capable ones). */
const idOf = (res: request.Response): string => {
    const data = (res.body as { data?: Created | Created[] }).data;
    const id = Array.isArray(data) ? data[0]?.id : data?.id;

    if (res.status !== 201 || !id) {
        throw new Error(`creation failed (${res.status}): ${JSON.stringify(res.body)}`);
    }

    return id;
};

/** App, banco, conta (com saldo de abertura), cartão e tipos, tudo pelas rotas públicas. */
export async function seedReporting(
    schema: string,
    openingBalanceCents: number,
): Promise<ReportingFixture> {
    const ctx = await startApp(schema);

    await request(ctx.app).get('/users/me').set('Authorization', ADMIN);
    await ctx.setProfile('uid-admin', 'ADMIN');

    const send = (path: string, body: Record<string, unknown>) =>
        request(ctx.app).post(path).set('Authorization', ADMIN).send(body);

    const bankId = idOf(await send('/banks', { febrabanCode: '260', name: 'Nu Pagamentos' }));
    const accountId = idOf(
        await send('/bank-accounts', {
            bankId,
            type: 'CHECKING',
            accountNumber: '1-1',
            description: 'Conta',
            openingBalanceCents,
        }),
    );
    const cardId = idOf(
        await send('/credit-cards', {
            bankId,
            name: 'Platinum',
            creditLimitCents: 50000,
            closingDay: 28,
            dueDay: 5,
        }),
    );
    const expenseTypeId = idOf(await send('/expense-types', { name: 'T-Mercado' }));
    const earningTypeId = idOf(await send('/earning-types', { name: 'T-Salário' }));

    return { ctx, accountId, cardId, expenseTypeId, earningTypeId };
}

/** Receita criada e recebida em `receivedOn` pela API (move o saldo corrente). */
export async function receiveEarning(
    fx: ReportingFixture,
    amountCents: number,
    receivedOn: string,
): Promise<void> {
    const created = await request(fx.ctx.app).post('/earnings').set('Authorization', ADMIN).send({
        description: 'Receita',
        earningTypeId: fx.earningTypeId,
        kind: 'VARIABLE',
        amountCents,
        occurredOn: receivedOn,
        bankAccountId: fx.accountId,
    });

    const res = await request(fx.ctx.app)
        .patch(`/earnings/${idOf(created)}/status`)
        .set('Authorization', ADMIN)
        .send({ status: 'RECEIVED', receivedOn });

    if (res.status !== 200) throw new Error(`earning not received: ${JSON.stringify(res.body)}`);
}

/** Despesa de conta criada e paga em `paidOn` pela API (move o saldo corrente). */
export async function payExpense(
    fx: ReportingFixture,
    amountCents: number,
    paidOn: string,
): Promise<void> {
    const created = await request(fx.ctx.app).post('/expenses').set('Authorization', ADMIN).send({
        description: 'Despesa',
        expenseTypeId: fx.expenseTypeId,
        kind: 'VARIABLE',
        amountCents,
        occurredOn: paidOn,
        bankAccountId: fx.accountId,
    });

    const res = await request(fx.ctx.app)
        .patch(`/expenses/${idOf(created)}/status`)
        .set('Authorization', ADMIN)
        .send({ status: 'PAID', paidOn });

    if (res.status !== 200) throw new Error(`expense not paid: ${JSON.stringify(res.body)}`);
}

/**
 * Pagamento de fatura pela rota real: uma compra de cartão em 03/03 fecha a fatura de 10/03 e
 * é paga em `paidOn`, o que debita a conta pela lógica do `statements`. Exige o relógio
 * congelado em data igual ou posterior a `paidOn`.
 */
export async function payStatement(
    fx: ReportingFixture,
    amountCents: number,
    paidOn: string,
): Promise<void> {
    await fx.ctx.dataSource.query(
        "UPDATE credit_cards SET closing_day = 10, due_day = 20, created_at = '2026-01-15T12:00:00Z'",
    );
    await fx.ctx.dataSource.query(
        `INSERT INTO expenses (description, expense_type_id, kind, status, amount_cents, occurred_on,
                               credit_card_id, posted_on)
         VALUES ('Compra', $1, 'VARIABLE', 'OPEN', $2::numeric / 100, '2026-03-03', $3, '2026-03-03')`,
        [fx.expenseTypeId, amountCents, fx.cardId],
    );

    const list = await request(fx.ctx.app)
        .get(`/statements?creditCardId=${fx.cardId}&from=2026-03-10&to=2026-03-10`)
        .set('Authorization', ADMIN);
    const statement = (
        list.body as { data: Array<{ id: string | null; closesOn: string }> }
    ).data.find((item) => item.closesOn === '2026-03-10');
    const res = await request(fx.ctx.app)
        .post(`/statements/${statement?.id}/payments`)
        .set('Authorization', ADMIN)
        .send({ bankAccountId: fx.accountId, amountCents, paidOn });

    if (res.status !== 201) throw new Error(`payment failed: ${JSON.stringify(res.body)}`);
}

export async function currentBalanceCents(fx: ReportingFixture): Promise<number> {
    const rows = (await fx.ctx.dataSource.query(
        'SELECT (current_balance_cents * 100)::bigint::text AS cents FROM bank_accounts WHERE id = $1',
        [fx.accountId],
    )) as Array<{ cents: string }>;

    return Number(rows[0]!.cents);
}

/** Only `Date` is faked: sockets, timers and the event loop stay real. */
export const DATE_ONLY = [
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

const firstId = async (fx: ReportingFixture, sql: string, params: unknown[]): Promise<string> => {
    const rows = (await fx.ctx.dataSource.query(sql, params)) as Array<{ id: string }>;

    return rows[0]!.id;
};

/** Mais uma conta, direto no banco: `openingBalanceCents` também é o saldo corrente. */
export async function addAccount(
    fx: ReportingFixture,
    accountNumber: string,
    openingBalanceCents: number,
): Promise<string> {
    return firstId(
        fx,
        `INSERT INTO bank_accounts (bank_id, type, account_number, description,
                                    opening_balance_cents, current_balance_cents)
         VALUES ((SELECT id FROM banks LIMIT 1), 'CHECKING', $1, 'Conta', $2::numeric / 100,
                 $2::numeric / 100)
         RETURNING id`,
        [accountNumber, openingBalanceCents],
    );
}

/** Cartão com fechamento no dia 10 e vencimento no 20, cadastrado em 15/01/2026. */
export async function addCard(
    fx: ReportingFixture,
    name: string,
    paymentBankAccountId: string | null,
): Promise<string> {
    return firstId(
        fx,
        `INSERT INTO credit_cards (bank_id, name, credit_limit_cents, available_limit_cents,
                                   closing_day, due_day, created_at, payment_bank_account_id)
         VALUES ((SELECT id FROM banks LIMIT 1), $1, 500, 500, 10, 20,
                 '2026-01-15T12:00:00Z', $2)
         RETURNING id`,
        [name, paymentBankAccountId],
    );
}

/** Receita direto no banco, em qualquer status (`RECEIVED` leva `received_on`). */
export async function insertEarning(
    fx: ReportingFixture,
    status: string,
    amountCents: number,
    occurredOn: string,
    accountId: string = fx.accountId,
): Promise<void> {
    await fx.ctx.dataSource.query(
        `INSERT INTO earnings (description, earning_type_id, kind, status, amount_cents,
                               occurred_on, received_on, bank_account_id)
         VALUES ('Receita', $1, 'VARIABLE', $2, $3::numeric / 100, $4::date,
                 CASE WHEN $2 = 'RECEIVED' THEN $4::date END, $5)`,
        [fx.earningTypeId, status, amountCents, occurredOn, accountId],
    );
}

/** Despesa de conta (`accountId`) ou de cartão (`cardId`, lançada em `occurredOn`). */
export async function insertExpense(
    fx: ReportingFixture,
    status: string,
    amountCents: number,
    occurredOn: string,
    owner: { accountId: string } | { cardId: string },
): Promise<void> {
    const cardId = 'cardId' in owner ? owner.cardId : null;
    const accountId = 'accountId' in owner ? owner.accountId : null;

    await fx.ctx.dataSource.query(
        `INSERT INTO expenses (description, expense_type_id, kind, status, amount_cents,
                               occurred_on, paid_on, bank_account_id, credit_card_id, posted_on)
         VALUES ('Despesa', $1, 'VARIABLE', $2, $3::numeric / 100, $4::date,
                 CASE WHEN $2 = 'PAID' THEN $4::date END, $5, $6,
                 CASE WHEN $6::uuid IS NOT NULL THEN $4::date END)`,
        [fx.expenseTypeId, status, amountCents, occurredOn, accountId, cardId],
    );
}

export type BalancePointBody = {
    month: string;
    kind: 'REALIZED' | 'FORECAST';
    accounts: Array<{
        bankAccountId: string;
        balanceCents: number;
        pendingEarningsCents?: number;
        pendingExpensesCents?: number;
        cardDebtCents?: number;
        balanceAfterCardsCents?: number;
    }>;
    accountsTotalCents: number;
    cardDebtCents: number | null;
    unassignedCardDebtCents: number | null;
    cardDueCents: number | null;
    consolidatedCents: number | null;
};

/** `GET /reports/balance`; devolve os pontos e falha se a resposta não for 200. */
export async function getBalance(
    fx: ReportingFixture,
    from: string,
    to: string,
    bankAccountId?: string,
): Promise<BalancePointBody[]> {
    const extra = bankAccountId ? `&bankAccountId=${bankAccountId}` : '';
    const res = await request(fx.ctx.app)
        .get(`/reports/balance?from=${from}&to=${to}${extra}`)
        .set('Authorization', ADMIN);

    if (res.status !== 200) {
        throw new Error(`balance failed (${res.status}): ${JSON.stringify(res.body)}`);
    }

    return (res.body as { data: { points: BalancePointBody[] } }).data.points;
}
