import request from 'supertest';

import { BankAccount } from '../../../src/accounts';
import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_earnings_creation';
const BILLER = 'Bearer uid-biller';
const VIEWER = 'Bearer uid-viewer';
const MISSING = '00000000-0000-4000-8000-000000000000';

describe('POST /earnings (spec 0014)', () => {
    let ctx: TestApp;
    let accountId: string;
    let typeId: string;

    const post = (body: Record<string, unknown>, auth = BILLER) =>
        request(ctx.app).post('/earnings').set('Authorization', auth).send(body);
    const valid = (extra: Record<string, unknown> = {}) => ({
        description: 'Salário de março',
        earningTypeId: typeId,
        kind: 'VARIABLE',
        amountCents: 500000,
        occurredOn: '2026-03-05',
        bankAccountId: accountId,
        ...extra,
    });
    const fieldsOf = (response: request.Response): string[] =>
        (response.body.error.details as { path: string[] }[]).map((issue) => issue.path.join('.'));

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        for (const [uid, profile] of [
            ['uid-biller', 'BILLER'],
            ['uid-viewer', 'VIEWER'],
        ] as const) {
            await request(ctx.app).get('/users/me').set('Authorization', `Bearer ${uid}`);
            await ctx.setProfile(uid, profile);
        }

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

    describe('criação', () => {
        it('devolve 201 com uma lista de um EarningResponse', async () => {
            const response = await post(valid({ notes: 'obs' }));

            expect(response.status).toBe(201);
            expect(response.body.data).toHaveLength(1);
            expect(Object.keys(response.body.data[0])).toEqual([
                'id',
                'description',
                'kind',
                'status',
                'amountCents',
                'occurredOn',
                'receivedOn',
                'notes',
                'earningType',
                'bankAccountId',
                'installment',
                'createdAt',
                'updatedAt',
            ]);
            expect(response.body.data[0]).toMatchObject({
                description: 'Salário de março',
                kind: 'VARIABLE',
                status: 'OPEN',
                amountCents: 500000,
                occurredOn: '2026-03-05',
                receivedOn: null,
                notes: 'obs',
                bankAccountId: accountId,
                installment: null,
                earningType: { id: typeId, name: 'Teste Tipo', archivedAt: null },
            });
        });

        it.each(['OPEN', 'FORECAST', 'VERIFYING'])(
            'aceita o status %s na criação',
            async (status) => {
                const response = await post(valid({ status }));

                expect(response.status).toBe(201);
                expect(response.body.data[0].status).toBe(status);
            },
        );

        it('aceita FIXED', async () => {
            const response = await post(valid({ kind: 'FIXED' }));

            expect(response.status).toBe(201);
            expect(response.body.data[0].kind).toBe('FIXED');
        });

        it('INV-0014-02: a receita pertence à conta informada', async () => {
            const { id } = (await post(valid())).body.data[0];

            const rows = (await ctx.dataSource.query(
                'SELECT bank_account_id FROM earnings WHERE id = $1',
                [id],
            )) as { bank_account_id: string }[];

            expect(rows[0]?.bank_account_id).toBe(accountId);
        });
    });

    describe('ERR-0014-03', () => {
        it('recusa bankAccountId ausente com 400 citando o campo', async () => {
            const body: Record<string, unknown> = valid();
            delete body.bankAccountId;
            const response = await post(body);

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('VALIDATION_ERROR');
            expect(fieldsOf(response)).toContain('bankAccountId');
        });
    });

    describe('ERR-0014-04', () => {
        it('conta inexistente recebe 404 BANK_ACCOUNT_NOT_FOUND', async () => {
            const response = await post(valid({ bankAccountId: MISSING }));

            expect(response.status).toBe(404);
            expect(response.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
        });

        it('tipo inexistente recebe 404 EARNING_TYPE_NOT_FOUND', async () => {
            const response = await post(valid({ earningTypeId: MISSING }));

            expect(response.status).toBe(404);
            expect(response.body.error.code).toBe('EARNING_TYPE_NOT_FOUND');
        });
    });

    describe('AC-0014-08, ERR-0014-05, ERR-0014-06', () => {
        it('conta arquivada recebe 409 BANK_ACCOUNT_ARCHIVED', async () => {
            await ctx.dataSource.query('UPDATE bank_accounts SET archived_at = now()');

            const response = await post(valid());

            expect(response.status).toBe(409);
            expect(response.body.error.code).toBe('BANK_ACCOUNT_ARCHIVED');
        });

        it('tipo arquivado recebe 409 EARNING_TYPE_ARCHIVED', async () => {
            await ctx.dataSource.query(
                'UPDATE earning_types SET archived_at = now() WHERE id = $1',
                [typeId],
            );

            const response = await post(valid());

            expect(response.status).toBe(409);
            expect(response.body.error.code).toBe('EARNING_TYPE_ARCHIVED');
        });

        it('nada é gravado quando a criação é recusada', async () => {
            await ctx.dataSource.query('UPDATE bank_accounts SET archived_at = now()');

            await post(valid());

            const rows = (await ctx.dataSource.query(
                'SELECT count(*)::int AS n FROM earnings',
            )) as { n: number }[];
            expect(rows[0]?.n).toBe(0);
        });
    });

    describe('ERR-0014-07', () => {
        it('recusa kind fora da lista citando o campo', async () => {
            const response = await post(valid({ kind: 'RECURRING' }));

            expect(response.status).toBe(400);
            expect(fieldsOf(response)).toContain('kind');
        });

        it.each(['VARIABLE', 'FIXED'])('recusa installmentTotal em %s', async (kind) => {
            const response = await post(valid({ kind, installmentTotal: 3 }));

            expect(response.status).toBe(400);
            expect(fieldsOf(response)).toContain('installmentTotal');
        });
    });

    describe('ERR-0014-09', () => {
        it.each(['RECEIVED', 'OVERDUE', 'PAID'])('recusa status %s na criação', async (status) => {
            const response = await post(valid({ status }));

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('VALIDATION_ERROR');
            expect(fieldsOf(response)).toContain('status');
        });
    });

    describe('ERR-0014-12, AC-0014-13, INV-0014-01', () => {
        it.each([0, -100, 10.5, 400.4, '100'])(
            'recusa amountCents %p com 400',
            async (amountCents) => {
                const response = await post(valid({ amountCents }));

                expect(response.status).toBe(400);
                expect(fieldsOf(response)).toContain('amountCents');
            },
        );

        it('guarda o valor com no máximo duas casas', async () => {
            const { id } = (await post(valid({ amountCents: 12345 }))).body.data[0];

            const rows = (await ctx.dataSource.query(
                'SELECT amount_cents::text AS amount FROM earnings WHERE id = $1',
                [id],
            )) as { amount: string }[];

            expect(rows[0]?.amount).toBe('123.45');
        });
    });

    describe('guardas de perfil e corpo', () => {
        it('VIEWER recebe 403 FORBIDDEN', async () => {
            const response = await post(valid(), VIEWER);

            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe('FORBIDDEN');
        });

        it('recusa campo desconhecido com 400', async () => {
            const response = await post(valid({ receivedOn: '2026-03-05' }));

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('VALIDATION_ERROR');
        });
    });
});
