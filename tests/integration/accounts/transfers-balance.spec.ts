import request from 'supertest';
import type { DataSource } from 'typeorm';

import { BankAccount, BankAccountService, BankTransferService } from '../../../src/accounts';
import { container } from '../../../src/container';
import { TRANSFER_COMPLETED } from '../../../src/events';
import {
    DomainEventDispatcherSymbol,
    TransactionRunnerSymbol,
    type DomainEvent,
    type DomainEventDispatcher,
    type TransactionRunner,
} from '../../../src/platform';
import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_accounts_transfers_balance';
const BILLER = 'Bearer uid-biller';

describe('saldo das transferências (spec 0018)', () => {
    let ctx: TestApp;
    let dataSource: DataSource;
    let accountA: string;
    let accountB: string;
    let events: DomainEvent[];

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        dataSource = ctx.dataSource;

        const dispatcher = container.resolve<DomainEventDispatcher>(DomainEventDispatcherSymbol);
        dispatcher.subscribe(TRANSFER_COMPLETED, (event) => {
            events.push(event);
            return Promise.resolve();
        });
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        events = [];
        await request(ctx.app).get('/users/me').set('Authorization', BILLER);
        await ctx.setProfile('uid-biller', 'BILLER');

        const [bank] = await dataSource.query<{ id: string }[]>(
            "INSERT INTO banks (febraban_code, name) VALUES ('260', 'Nu Pagamentos') RETURNING id",
        );
        const repository = dataSource.getRepository(BankAccount);
        const make = (accountNumber: string, balance: number) =>
            repository.save(
                repository.create({
                    bankId: bank!.id,
                    type: 'CHECKING',
                    accountNumber,
                    description: accountNumber,
                    openingBalanceCents: balance,
                    currentBalanceCents: balance,
                    overdraftLimitCents: 0,
                    archivedAt: null,
                }),
            );

        accountA = (await make('A', 100000)).id;
        accountB = (await make('B', 5000)).id;
    });

    afterEach(async () => {
        await dataSource.query('DELETE FROM bank_transfers');
        await dataSource.query('DELETE FROM bank_accounts');
        await dataSource.query('DELETE FROM banks');
    });

    const balanceOf = async (id: string): Promise<number> =>
        (await dataSource.getRepository(BankAccount).findOneByOrFail({ id })).currentBalanceCents;

    const transfer = (body: Record<string, unknown>) =>
        request(ctx.app)
            .post('/bank-transfers')
            .set('Authorization', BILLER)
            .send({
                fromBankAccountId: accountA,
                toBankAccountId: accountB,
                amountCents: 30000,
                occurredOn: '2026-03-10',
                description: 'Reserva',
                ...body,
            });

    const changeStatus = (id: string, body: Record<string, unknown>) =>
        request(ctx.app)
            .patch(`/bank-transfers/${id}/status`)
            .set('Authorization', BILLER)
            .send(body);

    it('AC-0018-02, INV-0018-03: concluída move as duas contas e publica depois do commit', async () => {
        const response = await transfer({});

        expect(response.status).toBe(201);
        expect(response.body.data).toMatchObject({
            status: 'COMPLETED',
            completedOn: '2026-03-10',
            amountCents: 30000,
        });
        expect(await balanceOf(accountA)).toBe(70000);
        expect(await balanceOf(accountB)).toBe(35000);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            name: TRANSFER_COMPLETED,
            payload: {
                transferId: response.body.data.id,
                fromBankAccountId: accountA,
                toBankAccountId: accountB,
                amountCents: 30000,
                completedOn: '2026-03-10',
            },
        });
    });

    it('AC-0018-03, INV-0018-03: falha no movimento da segunda conta não deixa saldo nem evento', async () => {
        const accounts = new BankAccountService(dataSource);
        const original = accounts.applyBalanceDelta.bind(accounts);
        let calls = 0;
        jest.spyOn(accounts, 'applyBalanceDelta').mockImplementation(async (...args) => {
            calls += 1;
            if (calls === 2) throw new Error('segunda conta falhou');
            await original(...args);
        });
        const service = new BankTransferService(
            container.resolve<TransactionRunner>(TransactionRunnerSymbol),
            accounts,
        );

        await expect(
            service.create({
                fromBankAccountId: accountA,
                toBankAccountId: accountB,
                amountCents: 30000,
                occurredOn: '2026-03-10',
                description: 'Reserva',
            }),
        ).rejects.toThrow('segunda conta falhou');

        expect(calls).toBe(2);
        expect(await balanceOf(accountA)).toBe(100000);
        expect(await balanceOf(accountB)).toBe(5000);
        expect(await dataSource.query('SELECT 1 FROM bank_transfers')).toHaveLength(0);
        expect(events).toHaveLength(0);
    });

    it('AC-0018-04, INV-0018-04: A→B e B→A simultâneas terminam sem deadlock e com os saldos certos', async () => {
        const responses = await Promise.all(
            Array.from({ length: 8 }, (_, i) =>
                i % 2 === 0
                    ? transfer({ amountCents: 1000 })
                    : transfer({
                          fromBankAccountId: accountB,
                          toBankAccountId: accountA,
                          amountCents: 400,
                      }),
            ),
        );

        expect(responses.map((r) => r.status)).toEqual(Array(8).fill(201));
        // 4 × (A→B 1000) e 4 × (B→A 400): A perde 2400, B ganha 2400.
        expect(await balanceOf(accountA)).toBe(100000 - 2400);
        expect(await balanceOf(accountB)).toBe(5000 + 2400);
    });

    it('AC-0018-05, INV-0018-05: agendada não move; concluir move e grava completedOn; desfazer devolve', async () => {
        const created = await transfer({ status: 'SCHEDULED' });

        expect(created.status).toBe(201);
        expect(created.body.data).toMatchObject({ status: 'SCHEDULED', completedOn: null });
        expect(await balanceOf(accountA)).toBe(100000);
        expect(await balanceOf(accountB)).toBe(5000);
        expect(events).toHaveLength(0);

        const id = created.body.data.id as string;

        const completed = await changeStatus(id, { status: 'COMPLETED' });

        expect(completed.status).toBe(200);
        expect(completed.body.data.status).toBe('COMPLETED');
        expect(completed.body.data.completedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(await balanceOf(accountA)).toBe(70000);
        expect(await balanceOf(accountB)).toBe(35000);
        expect(events).toHaveLength(1);
        expect(events[0]!.payload).toMatchObject({
            transferId: id,
            completedOn: completed.body.data.completedOn,
        });

        const undone = await changeStatus(id, { status: 'SCHEDULED' });

        expect(undone.status).toBe(200);
        expect(undone.body.data).toMatchObject({ status: 'SCHEDULED', completedOn: null });
        expect(await balanceOf(accountA)).toBe(100000);
        expect(await balanceOf(accountB)).toBe(5000);
        expect(events).toHaveLength(1);
    });

    it('concluir aceita completedOn explícito', async () => {
        const created = await transfer({ status: 'SCHEDULED' });
        const completed = await changeStatus(created.body.data.id as string, {
            status: 'COMPLETED',
            completedOn: '2026-03-12',
        });

        expect(completed.body.data.completedOn).toBe('2026-03-12');
    });
});
