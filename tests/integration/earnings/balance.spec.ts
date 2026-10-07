import request from 'supertest';

import { BankAccount } from '../../../src/accounts';
import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_earnings_balance';
const BILLER = 'Bearer uid-biller';

describe('criação de receita não move o saldo (spec 0014, AC-0014-03, INV-0014-03)', () => {
    let ctx: TestApp;
    let accountId: string;
    let typeId: string;

    const post = (status?: string) =>
        request(ctx.app)
            .post('/earnings')
            .set('Authorization', BILLER)
            .send({
                description: 'Salário',
                earningTypeId: typeId,
                kind: 'VARIABLE',
                amountCents: 500000,
                occurredOn: '2026-03-05',
                bankAccountId: accountId,
                ...(status ? { status } : {}),
            });
    const balance = async (): Promise<number> => {
        const account = await ctx.dataSource
            .getRepository(BankAccount)
            .findOneByOrFail({ id: accountId });

        return account.currentBalanceCents;
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
                openingBalanceCents: 100000,
                currentBalanceCents: 100000,
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

    it('criar OPEN devolve 201 e não altera currentBalanceCents', async () => {
        const response = await post();

        expect(response.status).toBe(201);
        expect(await balance()).toBe(100000);
    });

    it.each(['FORECAST', 'VERIFYING'])('criar como %s também não altera', async (status) => {
        const response = await post(status);

        expect(response.status).toBe(201);
        expect(await balance()).toBe(100000);
    });
});
