import request from 'supertest';

import { BankAccount } from '../../../src/accounts';
import { Earning } from '../../../src/earnings';
import { startApp, stopApp, type TestApp } from '../app.helper';

export const BILLER = 'Bearer uid-biller';
export const MISSING = '00000000-0000-4000-8000-000000000000';

export type EarningFixtures = {
    readonly ctx: TestApp;
    readonly accountId: string;
    readonly typeId: string;
    makeAccount(accountNumber: string, archivedAt?: Date | null): Promise<BankAccount>;
    seed(status?: Earning['status'], extra?: Partial<Earning>): Promise<string>;
    balanceOf(accountId: string): Promise<number>;
};

/**
 * Registra os hooks do Jest do `describe` corrente: sobe o app no schema dado, cria
 * um BILLER, uma conta e um tipo por teste e limpa tudo no fim de cada um.
 */
export const useEarningFixtures = (schema: string): EarningFixtures => {
    let ctx: TestApp;
    let accountId = '';
    let typeId = '';

    const makeAccount = async (
        accountNumber: string,
        archivedAt: Date | null = null,
    ): Promise<BankAccount> => {
        const rows = (await ctx.dataSource.query(
            "SELECT id FROM banks WHERE febraban_code = '260'",
        )) as Array<{ id: string }>;
        const bankId =
            rows[0]?.id ??
            (
                (await ctx.dataSource.query(
                    "INSERT INTO banks (febraban_code, name) VALUES ('260', 'Nu') RETURNING id",
                )) as Array<{ id: string }>
            )[0]!.id;
        const accounts = ctx.dataSource.getRepository(BankAccount);

        return accounts.save(
            accounts.create({
                bankId,
                type: 'CHECKING',
                accountNumber,
                description: accountNumber,
                openingBalanceCents: 1000,
                currentBalanceCents: 1000,
                overdraftLimitCents: 0,
                archivedAt,
            }),
        );
    };

    const seed = async (
        status: Earning['status'] = 'OPEN',
        extra: Partial<Earning> = {},
    ): Promise<string> => {
        const earnings = ctx.dataSource.getRepository(Earning);
        const saved = await earnings.save(
            earnings.create({
                description: 'Salário',
                earningTypeId: typeId,
                kind: 'VARIABLE',
                status,
                amountCents: 5000,
                occurredOn: '2026-03-05',
                receivedOn: status === 'RECEIVED' ? '2026-03-06' : null,
                bankAccountId: accountId,
                installmentGroupId: null,
                installmentNumber: null,
                installmentTotal: null,
                notes: null,
                ...extra,
            }),
        );

        return saved.id;
    };

    const balanceOf = async (id: string): Promise<number> => {
        const account = await ctx.dataSource.getRepository(BankAccount).findOneByOrFail({ id });

        return account.currentBalanceCents;
    };

    beforeAll(async () => {
        ctx = await startApp(schema);
    });

    afterAll(async () => {
        await stopApp(ctx, schema);
    });

    beforeEach(async () => {
        await request(ctx.app).get('/users/me').set('Authorization', BILLER);
        await ctx.setProfile('uid-biller', 'BILLER');
        accountId = (await makeAccount('1-1')).id;
        const [type] = (await ctx.dataSource.query(
            "INSERT INTO earning_types (name) VALUES ('Teste Tipo') RETURNING id",
        )) as Array<{ id: string }>;
        typeId = type!.id;
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM earnings');
        await ctx.dataSource.query('DELETE FROM bank_accounts');
        await ctx.dataSource.query('DELETE FROM banks');
        await ctx.dataSource.query("DELETE FROM earning_types WHERE name LIKE 'Teste%'");
    });

    return {
        get ctx() {
            return ctx;
        },
        get accountId() {
            return accountId;
        },
        get typeId() {
            return typeId;
        },
        makeAccount,
        seed,
        balanceOf,
    };
};
