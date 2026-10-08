import request from 'supertest';

import { BankAccount, BankAccountService, BankAccountServiceSymbol } from '../../../src/accounts';
import { container } from '../../../src/container';
import { Earning } from '../../../src/earnings';
import { businessToday } from '../../../src/platform';
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

    // Saldo inicial 100000; a receita semeada vale 5000 (AC-0014-04, AC-0014-05).
    it('AC-0014-04: receber soma ao saldo e grava receivedOn de hoje; desfazer devolve', async () => {
        const id = await seedEarning(ctx, accountId, 'OPEN');

        const received = await patchStatus(ctx, id, { status: 'RECEIVED' });

        expect(received.status).toBe(200);
        expect(received.body.data.receivedOn).toBe(businessToday());
        expect(await balance()).toBe(105000);

        const undone = await patchStatus(ctx, id, { status: 'OPEN' });

        expect(undone.status).toBe(200);
        expect(undone.body.data.receivedOn).toBeNull();
        expect(await balance()).toBe(100000);
    });

    it('receivedOn informado é gravado', async () => {
        const id = await seedEarning(ctx, accountId, 'VERIFYING');

        const response = await patchStatus(ctx, id, {
            status: 'RECEIVED',
            receivedOn: '2026-03-07',
        });

        expect(response.body.data.receivedOn).toBe('2026-03-07');
        expect(await balance()).toBe(105000);
    });

    it('transições que não envolvem RECEIVED não movem o saldo', async () => {
        const id = await seedEarning(ctx, accountId, 'FORECAST');

        await patchStatus(ctx, id, { status: 'OPEN' });
        await patchStatus(ctx, id, { status: 'VERIFYING' });
        await patchStatus(ctx, id, { status: 'OPEN' });

        expect(await balance()).toBe(100000);
    });

    it('receber numa conta arquivada depois do lançamento é aceito (AC-0014-08)', async () => {
        const id = await seedEarning(ctx, accountId, 'OPEN');
        await ctx.dataSource.query('UPDATE bank_accounts SET archived_at = now()');

        const response = await patchStatus(ctx, id, { status: 'RECEIVED' });

        expect(response.status).toBe(200);
        expect(await balance()).toBe(105000);
    });

    it('AC-0014-05: se a gravação falha, o saldo e o status ficam como estavam', async () => {
        const id = await seedEarning(ctx, accountId, 'OPEN');
        const accounts = container.resolve<BankAccountService>(BankAccountServiceSymbol);
        const original = accounts.applyBalanceDelta.bind(accounts);
        const spy = jest
            .spyOn(accounts, 'applyBalanceDelta')
            .mockImplementation(async (...args) => {
                await original(...args);
                throw new Error('falha depois de mover o saldo');
            });

        try {
            const response = await patchStatus(ctx, id, { status: 'RECEIVED' });

            expect(response.status).toBe(500);
        } finally {
            spy.mockRestore();
        }

        expect(await balance()).toBe(100000);
        const row = await ctx.dataSource.getRepository(Earning).findOneByOrFail({ id });
        expect(row.status).toBe('OPEN');
        expect(row.receivedOn).toBeNull();
    });

    it('duas recepções simultâneas movem o saldo uma vez só', async () => {
        const id = await seedEarning(ctx, accountId, 'OPEN');

        const responses = await Promise.all([
            patchStatus(ctx, id, { status: 'RECEIVED' }),
            patchStatus(ctx, id, { status: 'RECEIVED' }),
        ]);

        expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
        expect(await balance()).toBe(105000);
    }, 30_000);
});

async function seedEarning(ctx: TestApp, accountId: string, status: string): Promise<string> {
    const [type] = (await ctx.dataSource.query(
        "SELECT id FROM earning_types WHERE name = 'Teste Tipo'",
    )) as [{ id: string }];
    const earnings = ctx.dataSource.getRepository(Earning);
    const saved = await earnings.save(
        earnings.create({
            description: 'Salário',
            earningTypeId: type.id,
            kind: 'VARIABLE',
            status: status as Earning['status'],
            amountCents: 5000,
            occurredOn: '2026-03-05',
            receivedOn: status === 'RECEIVED' ? '2026-03-06' : null,
            bankAccountId: accountId,
            installmentGroupId: null,
            installmentNumber: null,
            installmentTotal: null,
            notes: null,
        }),
    );

    return saved.id;
}

const patchStatus = (ctx: TestApp, id: string, body: Record<string, unknown>) =>
    request(ctx.app).patch(`/earnings/${id}/status`).set('Authorization', BILLER).send(body);
