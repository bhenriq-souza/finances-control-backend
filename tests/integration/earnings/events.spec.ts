import request from 'supertest';

import { BankAccount } from '../../../src/accounts';
import { container } from '../../../src/container';
import { EARNING_CREATED, type EarningCreated } from '../../../src/events';
import { DomainEventDispatcherSymbol, type DomainEventDispatcher } from '../../../src/platform';
import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_earnings_events';
const BILLER = 'Bearer uid-biller';

describe('evento EarningCreated (spec 0014, AC-0014-11)', () => {
    let ctx: TestApp;
    let accountId: string;
    let typeId: string;
    let received: EarningCreated[];
    let unsubscribe: () => void;

    const post = (extra: Record<string, unknown> = {}) =>
        request(ctx.app)
            .post('/earnings')
            .set('Authorization', BILLER)
            .send({
                description: 'Salário',
                earningTypeId: typeId,
                kind: 'FIXED',
                amountCents: 500000,
                occurredOn: '2026-03-05',
                bankAccountId: accountId,
                ...extra,
            });

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

        received = [];
        unsubscribe = container
            .resolve<DomainEventDispatcher>(DomainEventDispatcherSymbol)
            .subscribe<EarningCreated>(EARNING_CREATED, async (event) => {
                // Só depois do commit a linha é visível por outra conexão.
                const rows = (await ctx.dataSource.query('SELECT id FROM earnings WHERE id = $1', [
                    event.payload.earningId,
                ])) as unknown[];
                expect(rows).toHaveLength(1);
                received.push(event);
            });
    });

    afterEach(async () => {
        unsubscribe();
        await ctx.dataSource.query('DELETE FROM earnings');
        await ctx.dataSource.query('DELETE FROM bank_accounts');
        await ctx.dataSource.query('DELETE FROM banks');
        await ctx.dataSource.query("DELETE FROM earning_types WHERE name LIKE 'Teste%'");
    });

    it('publica um EarningCreated por receita criada, com o payload da spec', async () => {
        const response = await post({ status: 'FORECAST' });

        expect(response.status).toBe(201);
        expect(received).toHaveLength(1);
        expect(received[0]?.name).toBe('EarningCreated');
        expect(received[0]?.payload).toEqual({
            earningId: response.body.data[0].id,
            kind: 'FIXED',
            status: 'FORECAST',
            amountCents: 500000,
            occurredOn: '2026-03-05',
            bankAccountId: accountId,
            installmentGroupId: null,
        });
    });

    it('não publica quando a criação é recusada', async () => {
        await ctx.dataSource.query('UPDATE bank_accounts SET archived_at = now()');

        const response = await post();

        expect(response.status).toBe(409);
        expect(received).toHaveLength(0);
    });
});
