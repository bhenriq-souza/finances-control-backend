import request from 'supertest';

import { BankAccount } from '../../../src/accounts';
import { Earning } from '../../../src/earnings';
import { startApp, stopApp, type TestApp } from '../app.helper';

const BILLER = 'Bearer uid-biller';
import { container } from '../../../src/container';
import { EarningService, EarningServiceSymbol } from '../../../src/earnings';

const SCHEMA = 'test_earnings_overdue';

describe('varredura de vencidas (spec 0014, AC-0014-07)', () => {
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

    const statusOf = async (id: string): Promise<string> =>
        (await ctx.dataSource.getRepository(Earning).findOneByOrFail({ id })).status;

    it('muda só as OPEN com occurredOn < asOf, devolve a contagem e é idempotente', async () => {
        const service = container.resolve<EarningService>(EarningServiceSymbol);
        const old = await seed('OPEN', '2026-03-01');
        const sameDay = await seed('OPEN', '2026-03-10');
        const future = await seed('OPEN', '2026-03-20');
        const forecast = await seed('FORECAST', '2026-03-01');
        const verifying = await seed('VERIFYING', '2026-03-01');
        const received = await seed('RECEIVED', '2026-03-01');

        const count = await service.markOverdue(new Date('2026-03-10T15:00:00Z'));

        expect(count).toBe(1);
        expect(await statusOf(old)).toBe('OVERDUE');
        expect(await statusOf(sameDay)).toBe('OPEN');
        expect(await statusOf(future)).toBe('OPEN');
        expect(await statusOf(forecast)).toBe('FORECAST');
        expect(await statusOf(verifying)).toBe('VERIFYING');
        expect(await statusOf(received)).toBe('RECEIVED');
        expect(await service.markOverdue(new Date('2026-03-10T15:00:00Z'))).toBe(0);
    });
});
