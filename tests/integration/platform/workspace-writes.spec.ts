import request from 'supertest';

import { container } from '../../../src/container';
import { EXPENSE_CREATED, type ExpenseCreated } from '../../../src/events';
import { DomainEventDispatcherSymbol, type DomainEventDispatcher } from '../../../src/platform';
import { startApp, stopApp, type TestApp } from '../app.helper';
import { createTwoWorkspaces, type TwoWorkspaces } from '../helpers/workspaces.helper';

const SCHEMA = 'test_workspace_writes';

/**
 * As escritas gravam o espaço de quem chama, lido do membro na requisição (spec 0021,
 * Escopo nas consultas e Jobs e eventos), com o harness de dois espaços.
 */
describe('escrita por espaço (spec 0021)', () => {
    let ctx: TestApp;
    let spaces: TwoWorkspaces;
    let bankId: string;
    let typeId: string;

    const workspaceOf = async (table: string, id: string): Promise<string> =>
        (
            (await ctx.dataSource.query(`SELECT workspace_id FROM ${table} WHERE id = $1`, [
                id,
            ])) as [{ workspace_id: string }]
        )[0].workspace_id;

    const createAccount = (side: TwoWorkspaces['a']) =>
        side.post('/bank-accounts', {
            bankId,
            type: 'CHECKING',
            accountNumber: '1234-5',
            description: 'Conta',
            openingBalanceCents: 1000,
        });

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        spaces = await createTwoWorkspaces(ctx);

        // Bancos e tipos são catálogo global (spec 0021): só o admin da plataforma escreve.
        await ctx.dataSource.query(
            'UPDATE users SET is_platform_admin = true WHERE firebase_uid = $1',
            ['uid-admin-a'],
        );
        bankId = (await spaces.a.post('/banks', { febrabanCode: '260', name: 'Nu' })).body.data
            .id as string;
        typeId = (await spaces.a.post('/expense-types', { name: 'T-Espaço' })).body.data
            .id as string;
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    it('AC-0021-04: A e B cadastram a mesma conta no mesmo banco, e cada uma fica no seu espaço', async () => {
        const inA = await createAccount(spaces.a);
        const inB = await createAccount(spaces.b);

        expect(inA.status).toBe(201);
        expect(inB.status).toBe(201);
        await expect(workspaceOf('bank_accounts', inA.body.data.id as string)).resolves.toBe(
            spaces.a.workspaceId,
        );
        await expect(workspaceOf('bank_accounts', inB.body.data.id as string)).resolves.toBe(
            spaces.b.workspaceId,
        );
        // Nenhuma resposta de domínio devolve o espaço (INV-0021-10).
        expect(inA.body.data).not.toHaveProperty('workspaceId');
    });

    it('a despesa grava o espaço do contexto, e o evento leva o espaço da linha', async () => {
        const accountId = (
            await spaces.b.post('/bank-accounts', {
                bankId,
                type: 'SAVINGS',
                accountNumber: '777-7',
                description: 'Poupança',
                openingBalanceCents: 0,
            })
        ).body.data.id as string;
        const received: ExpenseCreated[] = [];
        const unsubscribe = container
            .resolve<DomainEventDispatcher>(DomainEventDispatcherSymbol)
            .subscribe<ExpenseCreated>(EXPENSE_CREATED, (event) => {
                received.push(event);
                return Promise.resolve();
            });

        try {
            const response = await spaces.b.post('/expenses', {
                description: 'Mercado',
                expenseTypeId: typeId,
                kind: 'VARIABLE',
                amountCents: 1500,
                occurredOn: '2026-03-10',
                bankAccountId: accountId,
            });

            expect(response.status).toBe(201);
            const expenseId = response.body.data[0].id as string;
            await expect(workspaceOf('expenses', expenseId)).resolves.toBe(spaces.b.workspaceId);
            expect(received).toHaveLength(1);
            expect(received[0]?.workspaceId).toBe(spaces.b.workspaceId);
        } finally {
            unsubscribe();
        }
    });

    it('o banco recusa a despesa de A na conta de B, mesmo sem o filtro de leitura (INV-0021-04)', async () => {
        const accountOfB = (
            (await ctx.dataSource.query(
                'SELECT id FROM bank_accounts WHERE workspace_id = $1 LIMIT 1',
                [spaces.b.workspaceId],
            )) as [{ id: string }]
        )[0].id;

        const response = await spaces.a.post('/expenses', {
            description: 'Invasão',
            expenseTypeId: typeId,
            kind: 'VARIABLE',
            amountCents: 100,
            occurredOn: '2026-03-10',
            bankAccountId: accountOfB,
        });

        // A resposta certa (o erro de conta inexistente, ERR-0021-02) vem com o filtro de
        // leitura do `expenses` (T-0021-04); aqui importa que nada foi gravado.
        expect(response.status).toBeGreaterThanOrEqual(400);
        await expect(
            ctx.dataSource.query("SELECT 1 FROM expenses WHERE description = 'Invasão'"),
        ).resolves.toHaveLength(0);
    });

    it('ERR-0021-03: quem não é membro de espaço recebe 403 PROFILE_PENDING, mesmo admin da plataforma', async () => {
        await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-sem-espaco');
        await ctx.dataSource.query(
            "UPDATE users SET is_platform_admin = true WHERE firebase_uid = 'uid-sem-espaco'",
        );

        const response = await request(ctx.app)
            .get('/bank-accounts')
            .set('Authorization', 'Bearer uid-sem-espaco');

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('PROFILE_PENDING');
    });
});
