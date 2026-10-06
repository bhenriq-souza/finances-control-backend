import type { DataSource } from 'typeorm';

import {
    BankAccount,
    BankAccountService,
    CreditCard,
    CreditCardService,
} from '../../../src/accounts';
import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_accounts_apply_delta';
const MISSING = '00000000-0000-4000-8000-000000000000';

describe('movimentos de saldo e limite (spec 0012, AC-0012-10)', () => {
    let ctx: TestApp;
    let dataSource: DataSource;
    let accounts: BankAccountService;
    let cards: CreditCardService;
    let accountId: string;
    let cardId: string;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        dataSource = ctx.dataSource;
        accounts = new BankAccountService(dataSource);
        cards = new CreditCardService(dataSource);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        const [bank] = (await dataSource.query(
            'INSERT INTO banks (febraban_code, name) VALUES ($1, $2) RETURNING id',
            ['260', 'Nu Pagamentos'],
        )) as [{ id: string }];

        const accountRepository = dataSource.getRepository(BankAccount);
        const account = await accountRepository.save(
            accountRepository.create({
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

        const cardRepository = dataSource.getRepository(CreditCard);
        const card = await cardRepository.save(
            cardRepository.create({
                bankId: bank.id,
                name: 'Platinum',
                creditLimitCents: 500000,
                availableLimitCents: 500000,
                closingDay: 28,
                dueDay: 5,
                archivedAt: null,
            }),
        );
        cardId = card.id;
    });

    afterEach(async () => {
        await dataSource.query('DELETE FROM credit_cards');
        await dataSource.query('DELETE FROM bank_accounts');
        await dataSource.query('DELETE FROM banks');
    });

    const limit = async (): Promise<number> =>
        (await dataSource.getRepository(CreditCard).findOneByOrFail({ id: cardId }))
            .availableLimitCents;

    const balance = async (): Promise<number> =>
        (await dataSource.getRepository(BankAccount).findOneByOrFail({ id: accountId }))
            .currentBalanceCents;

    const onCard = (delta: number, id = cardId) =>
        dataSource.transaction((manager) => cards.applyAvailableLimitDelta(manager, id, delta));

    const onAccount = (delta: number, id = accountId) =>
        dataSource.transaction((manager) => accounts.applyBalanceDelta(manager, id, delta));

    it('duas criações concorrentes no mesmo cartão abatem a soma, sem perda de atualização', async () => {
        await Promise.all([onCard(-10000), onCard(-25000), onCard(-3333), onCard(-1)]);

        expect(await limit()).toBe(500000 - 10000 - 25000 - 3333 - 1);
    });

    it('movimentos concorrentes na mesma conta somam todos os deltas', async () => {
        await Promise.all([onAccount(-7000), onAccount(-12345), onAccount(500)]);

        expect(await balance()).toBe(100000 - 7000 - 12345 + 500);
    });

    it('aceita delta positivo e deixa saldo e limite negativos (INV-0012-09)', async () => {
        await onCard(-600000);
        await onAccount(-150000);

        expect(await limit()).toBe(-100000);
        expect(await balance()).toBe(-50000);

        await onCard(600000);

        expect(await limit()).toBe(500000);
    });

    it('aceita registro arquivado', async () => {
        await dataSource.query('UPDATE credit_cards SET archived_at = now()');
        await dataSource.query('UPDATE bank_accounts SET archived_at = now()');

        await onCard(-100);
        await onAccount(-100);

        expect(await limit()).toBe(499900);
        expect(await balance()).toBe(99900);
    });

    it('não abre transação própria: a reversão de quem chamou desfaz o movimento (INV-0004-03)', async () => {
        await expect(
            dataSource.transaction(async (manager) => {
                await cards.applyAvailableLimitDelta(manager, cardId, -100);
                await accounts.applyBalanceDelta(manager, accountId, -100);
                throw new Error('rollback');
            }),
        ).rejects.toThrow('rollback');

        expect(await limit()).toBe(500000);
        expect(await balance()).toBe(100000);
    });

    it('registro inexistente lança *_NOT_FOUND', async () => {
        await expect(onCard(-1, MISSING)).rejects.toMatchObject({
            code: 'CREDIT_CARD_NOT_FOUND',
        });
        await expect(onAccount(-1, MISSING)).rejects.toMatchObject({
            code: 'BANK_ACCOUNT_NOT_FOUND',
        });
    });

    it.each([0, 1.5, Number.NaN])('recusa delta inválido (%s)', async (delta) => {
        await expect(onCard(delta)).rejects.toThrow(RangeError);
        await expect(onAccount(delta)).rejects.toThrow(RangeError);
    });
});
