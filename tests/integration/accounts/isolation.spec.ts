import { startApp, stopApp, type TestApp } from '../app.helper';
import { createTwoWorkspaces, type TwoWorkspaces } from '../helpers/workspaces.helper';

const SCHEMA = 'test_accounts_isolation';
const MISSING = '00000000-0000-4000-8000-000000000000';

describe('isolamento de contas, cartões e bancos por espaço (spec 0021)', () => {
    let ctx: TestApp;
    let spaces: TwoWorkspaces;
    let bankId: string;
    let accountB: string;
    let cardB: string;

    const account = (accountNumber: string, description: string) => ({
        bankId,
        type: 'CHECKING',
        accountNumber,
        description,
        openingBalanceCents: 1000,
    });
    const card = (name: string, extra: Record<string, unknown> = {}) => ({
        bankId,
        name,
        creditLimitCents: 500000,
        closingDay: 28,
        dueDay: 5,
        ...extra,
    });
    const ids = (body: { data: { id: string }[] }) => body.data.map((row) => row.id);

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        spaces = await createTwoWorkspaces(ctx);
        // Escrita de catálogo é do admin da plataforma (spec 0021).
        await ctx.dataSource.query(
            'UPDATE users SET is_platform_admin = true WHERE firebase_uid = $1',
            ['uid-admin-a'],
        );
        bankId = (await spaces.a.post('/banks', { febrabanCode: '260', name: 'Nu' })).body.data
            .id as string;
        accountB = (await spaces.b.post('/bank-accounts', account('1-1', 'Conta B'))).body.data
            .id as string;
        cardB = (await spaces.b.post('/credit-cards', card('Cartão B'))).body.data.id as string;
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    describe('contas (AC-0021-11, INV-0021-03)', () => {
        it('AC-0021-11: A não lista a conta de B, nem arquivada', async () => {
            const inA = await spaces.a.post('/bank-accounts', account('2-2', 'Conta A'));
            expect(inA.status).toBe(201);

            const ativas = await spaces.a.get('/bank-accounts');
            const todas = await spaces.a.get('/bank-accounts?archived=true');

            expect(ids(ativas.body)).toEqual([inA.body.data.id]);
            expect(ids(todas.body)).not.toContain(accountB);
        });

        it('AC-0021-11, INV-0021-03: A lê, altera e arquiva a conta de B com o mesmo 404 do inexistente', async () => {
            const ausente = await spaces.a.get(`/bank-accounts/${MISSING}`);
            const attempts = [
                await spaces.a.get(`/bank-accounts/${accountB}`),
                await spaces.a.patch(`/bank-accounts/${accountB}`, { description: 'Invadida' }),
                await spaces.a.post(`/bank-accounts/${accountB}/archive`),
                await spaces.a.delete(`/bank-accounts/${accountB}/archive`),
            ];

            expect(ausente.status).toBe(404);
            for (const response of attempts) {
                expect(response.status).toBe(404);
                expect(response.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
                expect(response.body).toEqual(ausente.body);
            }
        });

        it('AC-0021-11: a conta de B segue intacta depois das tentativas de A', async () => {
            const response = await spaces.b.get(`/bank-accounts/${accountB}`);

            expect(response.body.data.description).toBe('Conta B');
            expect(response.body.data.archivedAt).toBeNull();
        });
    });

    describe('cartões (AC-0021-11, INV-0021-03)', () => {
        it('AC-0021-11: A não lista o cartão de B', async () => {
            const lista = await spaces.a.get('/credit-cards?archived=true');

            expect(ids(lista.body)).not.toContain(cardB);
        });

        it('AC-0021-11, INV-0021-03: A lê, altera e arquiva o cartão de B com o mesmo 404 do inexistente', async () => {
            const ausente = await spaces.a.get(`/credit-cards/${MISSING}`);
            const attempts = [
                await spaces.a.get(`/credit-cards/${cardB}`),
                await spaces.a.patch(`/credit-cards/${cardB}`, { creditLimitCents: 1 }),
                await spaces.a.post(`/credit-cards/${cardB}/archive`),
                await spaces.a.delete(`/credit-cards/${cardB}/archive`),
            ];

            expect(ausente.status).toBe(404);
            for (const response of attempts) {
                expect(response.status).toBe(404);
                expect(response.body.error.code).toBe('CREDIT_CARD_NOT_FOUND');
                expect(response.body).toEqual(ausente.body);
            }
            const intact = await spaces.b.get(`/credit-cards/${cardB}`);
            expect(intact.body.data.creditLimitCents).toBe(500000);
        });

        it('AC-0021-11, ERR-0021-02: criar cartão de A com a conta de pagamento de B responde como conta inexistente', async () => {
            const cross = await spaces.a.post(
                '/credit-cards',
                card('Cruzado', { paymentBankAccountId: accountB }),
            );
            const ausente = await spaces.a.post(
                '/credit-cards',
                card('Cruzado', { paymentBankAccountId: MISSING }),
            );

            expect(cross.status).toBe(404);
            expect(cross.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
            expect(cross.body).toEqual(ausente.body);
        });

        it('AC-0021-11, ERR-0021-02: trocar a conta de pagamento do cartão de A pela de B responde como conta inexistente', async () => {
            const own = await spaces.a.post('/credit-cards', card('Próprio'));
            const response = await spaces.a.patch(`/credit-cards/${own.body.data.id}`, {
                paymentBankAccountId: accountB,
            });

            expect(response.status).toBe(404);
            expect(response.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
        });
    });

    describe('bancos, catálogo global (AC-0021-18, INV-0021-08)', () => {
        it('AC-0021-18: o ADMIN que não é admin da plataforma lê, e A e B veem a mesma lista', async () => {
            const inA = await spaces.a.get('/banks');
            const inB = await spaces.b.get('/banks');

            expect(inA.status).toBe(200);
            expect(inB.status).toBe(200);
            expect(inB.body.data).toEqual(inA.body.data);
            expect(ids(inB.body)).toContain(bankId);
        });

        it('AC-0021-18, INV-0021-08, ERR-0021-04: o ADMIN que não é admin da plataforma recebe 403 ao criar, alterar e arquivar', async () => {
            const responses = [
                await spaces.b.post('/banks', { febrabanCode: '341', name: 'Itaú' }),
                await spaces.b.patch(`/banks/${bankId}`, { name: 'Outro' }),
                await spaces.b.post(`/banks/${bankId}/archive`),
                await spaces.b.delete(`/banks/${bankId}/archive`),
            ];

            for (const response of responses) {
                expect(response.status).toBe(403);
                expect(response.body.error.code).toBe('FORBIDDEN');
            }
        });

        it('AC-0021-18, INV-0021-08: o admin da plataforma cria, altera e arquiva', async () => {
            const created = await spaces.a.post('/banks', { febrabanCode: '341', name: 'Itaú' });
            const id = created.body.data.id as string;

            expect(created.status).toBe(201);
            expect((await spaces.a.patch(`/banks/${id}`, { name: 'Itaú Unibanco' })).status).toBe(
                200,
            );
            expect((await spaces.a.post(`/banks/${id}/archive`)).status).toBe(200);
            expect((await spaces.a.delete(`/banks/${id}/archive`)).status).toBe(200);
        });
    });
});
