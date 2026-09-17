import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_accounts_bank_accounts';
const ADMIN = 'Bearer uid-admin';

describe('rotas de /bank-accounts (spec 0011)', () => {
    let ctx: TestApp;
    let bankId: string;

    const createBank = async (febrabanCode: string, name: string): Promise<string> => {
        const { body } = await request(ctx.app)
            .post('/banks')
            .set('Authorization', ADMIN)
            .send({ febrabanCode, name });

        return body.data.id as string;
    };

    const createAccount = (overrides: Record<string, unknown> = {}, auth = ADMIN) =>
        request(ctx.app)
            .post('/bank-accounts')
            .set('Authorization', auth)
            .send({
                bankId,
                type: 'CHECKING',
                accountNumber: '12345-6',
                description: 'Conta principal',
                openingBalanceCents: 150000,
                ...overrides,
            });

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        await request(ctx.app).get('/users/me').set('Authorization', ADMIN);
        await ctx.setProfile('uid-admin', 'ADMIN');
        bankId = await createBank('260', 'Nu Pagamentos');
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM bank_accounts');
        await ctx.dataSource.query('DELETE FROM banks');
    });

    describe('POST /bank-accounts (AC-0011-01)', () => {
        it('cria com 201 e o corpo previsto, com o banco aninhado', async () => {
            const response = await createAccount();

            expect(response.status).toBe(201);
            expect(Object.keys(response.body.data)).toEqual([
                'id',
                'bank',
                'type',
                'accountNumber',
                'description',
                'openingBalanceCents',
                'currentBalanceCents',
                'overdraftLimitCents',
                'archivedAt',
                'createdAt',
            ]);
            expect(response.body.data.bank).toMatchObject({
                febrabanCode: '260',
                name: 'Nu Pagamentos',
            });
        });

        it('o saldo corrente nasce igual ao de abertura', async () => {
            const response = await createAccount({ openingBalanceCents: 987654 });

            expect(response.body.data).toMatchObject({
                openingBalanceCents: 987654,
                currentBalanceCents: 987654,
            });
        });

        it('aceita saldo de abertura negativo', async () => {
            const response = await createAccount({ openingBalanceCents: -50000 });

            expect(response.status).toBe(201);
            expect(response.body.data.currentBalanceCents).toBe(-50000);
        });

        it('aplica zero como limite de cheque especial quando omitido', async () => {
            const response = await createAccount();

            expect(response.body.data.overdraftLimitCents).toBe(0);
        });

        it('recusa o saldo corrente na entrada (INV-0011-04)', async () => {
            const response = await createAccount({ currentBalanceCents: 999 });

            expect(response.status).toBe(400);
            expect(JSON.stringify(response.body)).toContain('currentBalanceCents');
        });

        it.each([150.5, 0.01, -3.7])(
            'recusa fração de centavo (%p) com 400 (AC-0011-13)',
            async (openingBalanceCents) => {
                const response = await createAccount({ openingBalanceCents });

                expect(response.status).toBe(400);
                expect(response.body.error.code).toBe('VALIDATION_ERROR');
            },
        );

        it('recusa limite de cheque especial negativo', async () => {
            const response = await createAccount({ overdraftLimitCents: -1 });

            expect(response.status).toBe(400);
        });

        it.each(['POUPANCA', 'checking', ''])('recusa o tipo %p', async (type) => {
            const response = await createAccount({ type });

            expect(response.status).toBe(400);
        });

        it('recusa a mesma conta no mesmo banco com 409', async () => {
            await createAccount({ accountNumber: '99999-9' });

            const response = await createAccount({ accountNumber: '99999-9' });

            expect(response.status).toBe(409);
            expect(response.body.error.code).toBe('BANK_ACCOUNT_ALREADY_EXISTS');
        });

        it('aceita o mesmo número em bancos diferentes (AC-0011-03)', async () => {
            await createAccount({ accountNumber: '12345-6' });
            const outroBanco = await createBank('341', 'Itaú');

            const response = await createAccount({
                bankId: outroBanco,
                accountNumber: '12345-6',
            });

            expect(response.status).toBe(201);
        });

        it('responde 404 para banco inexistente (ERR-0011-05)', async () => {
            const response = await createAccount({
                bankId: '00000000-0000-4000-8000-000000000000',
            });

            expect(response.status).toBe(404);
            expect(response.body.error.code).toBe('BANK_NOT_FOUND');
        });

        it('recusa banco arquivado com 409 (AC-0011-11, ERR-0011-07)', async () => {
            await ctx.dataSource.query('UPDATE banks SET archived_at = now() WHERE id = $1', [
                bankId,
            ]);

            const response = await createAccount();

            expect(response.status).toBe(409);
            expect(response.body.error.code).toBe('BANK_ARCHIVED');
        });
    });

    describe('GET /bank-accounts', () => {
        it('lista ordenado por descrição, com o banco aninhado', async () => {
            await createAccount({ accountNumber: '1-1', description: 'Salário' });
            await createAccount({ accountNumber: '2-2', description: 'Emergência' });

            const response = await request(ctx.app)
                .get('/bank-accounts')
                .set('Authorization', ADMIN);

            expect(response.status).toBe(200);
            expect(
                response.body.data.map((account: { description: string }) => account.description),
            ).toEqual(['Emergência', 'Salário']);
            expect(response.body.data[0].bank.febrabanCode).toBe('260');
        });

        it('consulta por id', async () => {
            const { body } = await createAccount();

            const response = await request(ctx.app)
                .get(`/bank-accounts/${body.data.id}`)
                .set('Authorization', ADMIN);

            expect(response.status).toBe(200);
            expect(response.body.data.id).toBe(body.data.id);
        });

        it('responde 404 para conta inexistente (ERR-0011-06)', async () => {
            const response = await request(ctx.app)
                .get('/bank-accounts/00000000-0000-4000-8000-000000000000')
                .set('Authorization', ADMIN);

            expect(response.status).toBe(404);
            expect(response.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
        });
    });

    describe('PATCH /bank-accounts/:id (AC-0011-08)', () => {
        it('altera descrição, tipo, número e cheque especial', async () => {
            const { body } = await createAccount();

            const response = await request(ctx.app)
                .patch(`/bank-accounts/${body.data.id}`)
                .set('Authorization', ADMIN)
                .send({
                    description: 'Conta secundária',
                    type: 'SAVINGS',
                    accountNumber: '7-7',
                    overdraftLimitCents: 100000,
                });

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({
                description: 'Conta secundária',
                type: 'SAVINGS',
                accountNumber: '7-7',
                overdraftLimitCents: 100000,
            });
        });

        it.each(['currentBalanceCents', 'openingBalanceCents', 'bankId'])(
            'recusa alterar %s e não altera nada',
            async (field) => {
                const { body } = await createAccount({ openingBalanceCents: 1000 });

                const response = await request(ctx.app)
                    .patch(`/bank-accounts/${body.data.id}`)
                    .set('Authorization', ADMIN)
                    .send({ [field]: field === 'bankId' ? bankId : 424242 });

                expect(response.status).toBe(400);
                expect(JSON.stringify(response.body)).toContain(field);

                const depois = await request(ctx.app)
                    .get(`/bank-accounts/${body.data.id}`)
                    .set('Authorization', ADMIN);
                expect(depois.body.data).toMatchObject({
                    openingBalanceCents: 1000,
                    currentBalanceCents: 1000,
                });
            },
        );

        it('responde 404 para conta inexistente', async () => {
            const response = await request(ctx.app)
                .patch('/bank-accounts/00000000-0000-4000-8000-000000000000')
                .set('Authorization', ADMIN)
                .send({ description: 'Fantasma' });

            expect(response.status).toBe(404);
        });
    });

    describe('autorização (AC-0011-12)', () => {
        it.each(['BILLER', 'VIEWER'] as const)('%s lê, mas não escreve', async (profile) => {
            await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-comum');
            await ctx.setProfile('uid-comum', profile);

            const leitura = await request(ctx.app)
                .get('/bank-accounts')
                .set('Authorization', 'Bearer uid-comum');
            expect(leitura.status).toBe(200);

            const escrita = await createAccount({}, 'Bearer uid-comum');
            expect(escrita.status).toBe(403);
            expect(escrita.body.error.code).toBe('FORBIDDEN');
        });
    });
});
