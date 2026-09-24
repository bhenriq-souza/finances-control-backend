import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_accounts_archiving';
const ADMIN = 'Bearer uid-admin';

describe('arquivamento (spec 0011)', () => {
    let ctx: TestApp;
    let bankId: string;

    const post = (path: string, body: Record<string, unknown>, auth = ADMIN) =>
        request(ctx.app).post(path).set('Authorization', auth).send(body);

    const get = (path: string, auth = ADMIN) =>
        request(ctx.app).get(path).set('Authorization', auth);

    const archive = (path: string, auth = ADMIN) =>
        request(ctx.app).post(`${path}/archive`).set('Authorization', auth);

    const unarchive = (path: string, auth = ADMIN) =>
        request(ctx.app).delete(`${path}/archive`).set('Authorization', auth);

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        await request(ctx.app).get('/users/me').set('Authorization', ADMIN);
        await ctx.setProfile('uid-admin', 'ADMIN');

        const bank = await post('/banks', { febrabanCode: '260', name: 'Nu Pagamentos' });
        bankId = bank.body.data.id;
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM credit_cards');
        await ctx.dataSource.query('DELETE FROM bank_accounts');
        await ctx.dataSource.query('DELETE FROM banks');
    });

    const criarConta = async (): Promise<string> => {
        const { body } = await post('/bank-accounts', {
            bankId,
            type: 'CHECKING',
            accountNumber: '1-1',
            description: 'Conta',
            openingBalanceCents: 1000,
        });

        return body.data.id as string;
    };

    const criarCartao = async (): Promise<string> => {
        const { body } = await post('/credit-cards', {
            bankId,
            name: 'Platinum',
            creditLimitCents: 500000,
            closingDay: 28,
            dueDay: 5,
        });

        return body.data.id as string;
    };

    describe.each([
        // `/banks` não tem `GET /:id` — a spec 0011 não o prevê. Só as duas
        // coleções que têm a rota podem afirmar o "consultável por id".
        ['bancos', '/banks', async () => bankId, false],
        ['contas', '/bank-accounts', async () => criarConta(), true],
        ['cartões', '/credit-cards', async () => criarCartao(), true],
    ])('%s (AC-0011-09, INV-0011-03)', (_nome, collection, criar, temGetPorId) => {
        it('sai da listagem padrão e aparece com ?archived=true', async () => {
            const id = await criar();

            const arquivar = await archive(`${collection}/${id}`);
            expect(arquivar.status).toBe(200);
            expect(arquivar.body.data.archivedAt).not.toBeNull();

            const padrao = await get(collection);
            expect(padrao.body.data.map((item: { id: string }) => item.id)).not.toContain(id);

            const comArquivados = await get(`${collection}?archived=true`);
            expect(comArquivados.body.data.map((item: { id: string }) => item.id)).toContain(id);
        });

        (temGetPorId ? it : it.skip)('arquivado segue consultável por id', async () => {
            const id = await criar();
            await archive(`${collection}/${id}`);

            const porId = await get(`${collection}/${id}`);

            expect(porId.status).toBe(200);
            expect(porId.body.data.id).toBe(id);
            expect(porId.body.data.archivedAt).not.toBeNull();
        });

        it('desarquivar devolve à listagem', async () => {
            const id = await criar();
            await archive(`${collection}/${id}`);

            const resposta = await unarchive(`${collection}/${id}`);

            expect(resposta.status).toBe(200);
            expect(resposta.body.data.archivedAt).toBeNull();
            const padrao = await get(collection);
            expect(padrao.body.data.map((item: { id: string }) => item.id)).toContain(id);
        });

        it('arquivar duas vezes é idempotente (AC-0011-10, ERR-0011-12)', async () => {
            const id = await criar();

            const primeira = await archive(`${collection}/${id}`);
            const segunda = await archive(`${collection}/${id}`);

            expect(primeira.status).toBe(200);
            expect(segunda.status).toBe(200);
            // A segunda não reescreve: a data de arquivamento é a mesma.
            expect(segunda.body.data.archivedAt).toBe(primeira.body.data.archivedAt);
        });

        it('desarquivar o que não está arquivado também é idempotente', async () => {
            const id = await criar();

            const resposta = await unarchive(`${collection}/${id}`);

            expect(resposta.status).toBe(200);
            expect(resposta.body.data.archivedAt).toBeNull();
        });

        it('responde 404 ao arquivar registro inexistente', async () => {
            const resposta = await archive(`${collection}/00000000-0000-4000-8000-000000000000`);

            expect(resposta.status).toBe(404);
        });

        it('recusa valor inválido em ?archived', async () => {
            const resposta = await get(`${collection}?archived=talvez`);

            expect(resposta.status).toBe(400);
        });

        it('exige ADMIN para arquivar (AC-0011-12)', async () => {
            const id = await criar();
            await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-comum');
            await ctx.setProfile('uid-comum', 'BILLER');

            const resposta = await archive(`${collection}/${id}`, 'Bearer uid-comum');

            expect(resposta.status).toBe(403);
            expect(resposta.body.error.code).toBe('FORBIDDEN');
        });

        it('sem perfil, nem lista (AC-0011-12)', async () => {
            await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-pendente');

            const resposta = await get(collection, 'Bearer uid-pendente');

            expect(resposta.status).toBe(403);
            expect(resposta.body.error.code).toBe('PROFILE_PENDING');
        });
    });

    describe('o arquivado continua sustentando o histórico (INV-0011-03)', () => {
        it('a conta de um banco arquivado continua consultável e ligada a ele', async () => {
            const contaId = await criarConta();

            await archive(`/banks/${bankId}`);

            const conta = await get(`/bank-accounts/${contaId}`);
            expect(conta.status).toBe(200);
            expect(conta.body.data.bank.id).toBe(bankId);
            expect(conta.body.data.bank.archivedAt).not.toBeNull();
        });

        it('mas o banco arquivado não aceita conta nova (ERR-0011-07)', async () => {
            await archive(`/banks/${bankId}`);

            const resposta = await post('/bank-accounts', {
                bankId,
                type: 'CHECKING',
                accountNumber: '9-9',
                description: 'Nova',
                openingBalanceCents: 0,
            });

            expect(resposta.status).toBe(409);
            expect(resposta.body.error.code).toBe('BANK_ARCHIVED');
        });
    });
});
