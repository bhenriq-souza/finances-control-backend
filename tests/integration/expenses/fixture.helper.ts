import request from 'supertest';

import type { TestApp } from '../app.helper';

export const ADMIN = 'Bearer uid-admin';

export type Fixture = { accountId: string; cardId: string; typeId: string };

/** Banco, conta, cartão e tipo para as suítes de consulta e alteração de despesa. */
export async function seedFixture(ctx: TestApp): Promise<Fixture> {
    await request(ctx.app).get('/users/me').set('Authorization', ADMIN);
    await ctx.setProfile('uid-admin', 'ADMIN');

    const send = (path: string, body: Record<string, unknown>) =>
        request(ctx.app).post(path).set('Authorization', ADMIN).send(body);

    const bankId = (await send('/banks', { febrabanCode: '260', name: 'Nu Pagamentos' })).body.data
        .id as string;
    const accountId = (
        await send('/bank-accounts', {
            bankId,
            type: 'CHECKING',
            accountNumber: '1-1',
            description: 'Conta',
            openingBalanceCents: 100000,
        })
    ).body.data.id as string;
    const cardId = (
        await send('/credit-cards', {
            bankId,
            name: 'Platinum',
            creditLimitCents: 50000,
            closingDay: 28,
            dueDay: 5,
        })
    ).body.data.id as string;
    const typeId = (await send('/expense-types', { name: 'T-Mercado' })).body.data.id as string;

    return { accountId, cardId, typeId };
}

export async function cleanFixture(ctx: TestApp): Promise<void> {
    await ctx.dataSource.query('DELETE FROM expenses');
    await ctx.dataSource.query("DELETE FROM expense_types WHERE name LIKE 'T-%'");
    await ctx.dataSource.query('DELETE FROM credit_cards');
    await ctx.dataSource.query('DELETE FROM bank_accounts');
    await ctx.dataSource.query('DELETE FROM banks');
}

export type RawExpense = {
    typeId: string;
    status?: string;
    amountCents?: number;
    occurredOn?: string;
    accountId?: string;
    cardId?: string;
    group?: { id: string; number: number; total: number };
};

/** Insere direto no banco, para montar o cenário sem depender do parcelamento (T-0012-05). */
export async function insertExpense(ctx: TestApp, raw: RawExpense): Promise<string> {
    const status = raw.status ?? 'OPEN';
    const occurredOn = raw.occurredOn ?? '2026-03-10';
    const rows = (await ctx.dataSource.query(
        `INSERT INTO expenses (description, expense_type_id, kind, status, amount_cents, occurred_on,
            paid_on, bank_account_id, credit_card_id, posted_on, installment_group_id,
            installment_number, installment_total)
         VALUES ('Linha', $1, $2, $3, $4, $5::date, $6::date, $7, $8, $9::date, $10, $11, $12)
         RETURNING id`,
        [
            raw.typeId,
            raw.group ? 'INSTALLMENT' : 'VARIABLE',
            status,
            (raw.amountCents ?? 10000) / 100,
            occurredOn,
            status === 'PAID' ? occurredOn : null,
            raw.cardId ? null : (raw.accountId ?? null),
            raw.cardId ?? null,
            raw.cardId ? occurredOn : null,
            raw.group?.id ?? null,
            raw.group?.number ?? null,
            raw.group?.total ?? null,
        ],
    )) as { id: string }[];

    return rows[0]!.id;
}
