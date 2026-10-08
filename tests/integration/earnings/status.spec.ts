import request from 'supertest';

import { BankAccount } from '../../../src/accounts';
import { Earning } from '../../../src/earnings';
import { startApp, stopApp, type TestApp } from '../app.helper';

const BILLER = 'Bearer uid-biller';

const SCHEMA = 'test_earnings_status';

const ALL = ['OPEN', 'FORECAST', 'RECEIVED', 'OVERDUE', 'VERIFYING'] as const;
const ALLOWED: ReadonlyArray<readonly [string, string]> = [
    ['FORECAST', 'OPEN'],
    ['OPEN', 'VERIFYING'],
    ['OVERDUE', 'VERIFYING'],
    ['VERIFYING', 'OPEN'],
    ['OPEN', 'RECEIVED'],
    ['OVERDUE', 'RECEIVED'],
    ['VERIFYING', 'RECEIVED'],
    ['RECEIVED', 'OPEN'],
];
const FORBIDDEN = ALL.flatMap((from) => ALL.map((to) => [from, to] as const)).filter(
    ([from, to]) => !ALLOWED.some(([f, t]) => f === from && t === to),
);

describe('máquina de status da receita (spec 0014, AC-0014-06, INV-0014-05, ERR-0014-08)', () => {
    let ctx: TestApp;
    let accountId: string;
    let typeId: string;

    const seed = async (status: string, occurredOn = '2026-03-05'): Promise<string> => {
        const earnings = ctx.dataSource.getRepository(Earning);
        const saved = await earnings.save(
            earnings.create({
                description: 'Salário',
                earningTypeId: typeId,
                kind: 'VARIABLE',
                status: status as Earning['status'],
                amountCents: 5000,
                occurredOn,
                receivedOn: status === 'RECEIVED' ? '2026-03-06' : null,
                bankAccountId: accountId,
                installmentGroupId: null,
                installmentNumber: null,
                installmentTotal: null,
                notes: null,
            }),
        );

        return saved.id;
    };

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        await request(ctx.app).get('/users/me').set('Authorization', BILLER);
        await ctx.setProfile('uid-biller', 'BILLER');

        const [bank] = (await ctx.dataSource.query(
            'INSERT INTO banks (febraban_code, name) VALUES ($1, $2) RETURNING id',
            ['260', 'Nu Pagamentos'],
        )) as [{ id: string }];
        const accounts = ctx.dataSource.getRepository(BankAccount);
        const account = await accounts.save(
            accounts.create({
                bankId: bank.id,
                type: 'CHECKING',
                accountNumber: '1-1',
                description: 'Conta',
                openingBalanceCents: 1000,
                currentBalanceCents: 1000,
                overdraftLimitCents: 0,
                archivedAt: null,
            }),
        );
        accountId = account.id;

        const [type] = (await ctx.dataSource.query(
            "INSERT INTO earning_types (name) VALUES ('Teste Tipo') RETURNING id",
        )) as [{ id: string }];
        typeId = type.id;
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM earnings');
        await ctx.dataSource.query('DELETE FROM bank_accounts');
        await ctx.dataSource.query('DELETE FROM banks');
        await ctx.dataSource.query("DELETE FROM earning_types WHERE name LIKE 'Teste%'");
    });

    const patch = (id: string, body: Record<string, unknown>) =>
        request(ctx.app).patch(`/earnings/${id}/status`).set('Authorization', BILLER).send(body);

    it.each(ALLOWED)('aceita %s -> %s', async (from, to) => {
        const id = await seed(from);

        const response = await patch(id, { status: to });

        expect(response.status).toBe(200);
        expect(response.body.data.status).toBe(to);
    });

    it.each(FORBIDDEN)('recusa %s -> %s com 409', async (from, to) => {
        const id = await seed(from);

        const response = await patch(id, { status: to });

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('EARNING_STATUS_TRANSITION_NOT_ALLOWED');
        expect(response.body.error.message).toContain(from);
        expect(response.body.error.message).toContain(to);
    });

    it.each(['FORECAST', 'OVERDUE'])('INV-0014-05: %s como alvo é recusado', async (to) => {
        const id = await seed('OPEN');

        const response = await patch(id, { status: to });

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('EARNING_STATUS_TRANSITION_NOT_ALLOWED');
    });

    it('status desconhecido e receivedOn fora de RECEIVED são 400', async () => {
        const id = await seed('OPEN');

        expect((await patch(id, { status: 'NOPE' })).status).toBe(400);
        expect((await patch(id, { status: 'VERIFYING', receivedOn: '2026-03-06' })).status).toBe(
            400,
        );
    });

    it('ERR-0014-02: id inexistente é 404 EARNING_NOT_FOUND', async () => {
        const response = await patch('00000000-0000-4000-8000-000000000000', { status: 'OPEN' });

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('EARNING_NOT_FOUND');
    });

    it('VIEWER recebe 403', async () => {
        await ctx.setProfile('uid-biller', 'VIEWER');
        const id = await seed('OPEN');

        expect((await patch(id, { status: 'RECEIVED' })).status).toBe(403);
    });
});
