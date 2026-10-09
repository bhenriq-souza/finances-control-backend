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
