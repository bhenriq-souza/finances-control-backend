import { container } from '../../../src/container';
import {
    EarningRecurrenceServiceSymbol,
    EarningServiceSymbol,
    type EarningRecurrenceService,
    type EarningService,
} from '../../../src/earnings';
import { startApp, stopApp, type TestApp } from '../app.helper';
import { insertDomainRows, type DomainRows } from '../helpers/domain-rows.helper';
import { createTwoWorkspaces, type TwoWorkspaces } from '../helpers/workspaces.helper';

const SCHEMA = 'test_earnings_isolation';
const MISSING = '00000000-0000-4000-8000-000000000000';

/**
 * Receitas e séries de receita por espaço (spec 0021, AC-0021-13, INV-0021-03, INV-0021-06):
 * o id de outro espaço responde como id inexistente, e as rotinas diárias gravam no espaço da
 * linha de origem.
 */
describe('receitas: isolamento por espaço (AC-0021-13)', () => {
    let ctx: TestApp;
    let spaces: TwoWorkspaces;
    let a: DomainRows;
    let b: DomainRows;
    let typeId: string;
    let earnings: EarningService;
    let recurrences: EarningRecurrenceService;

    const count = async (sql: string, params: unknown[] = []): Promise<number> => {
        const [row] = (await ctx.dataSource.query(sql, params)) as [{ n: string }];

        return Number(row.n);
    };

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        spaces = await createTwoWorkspaces(ctx);
        earnings = container.resolve<EarningService>(EarningServiceSymbol);
        recurrences = container.resolve<EarningRecurrenceService>(EarningRecurrenceServiceSymbol);

        const [bank] = (await ctx.dataSource.query(
            "INSERT INTO banks (febraban_code, name) VALUES ('260', 'Nu') RETURNING id",
        )) as [{ id: string }];

        a = await insertDomainRows(ctx.dataSource, {
            bankId: bank.id,
            workspaceId: spaces.a.workspaceId,
            tag: 'a',
        });
        b = await insertDomainRows(ctx.dataSource, {
            bankId: bank.id,
            workspaceId: spaces.b.workspaceId,
            tag: 'b',
        });
        [{ id: typeId }] = (await ctx.dataSource.query(
            'SELECT id FROM earning_types ORDER BY name LIMIT 1',
        )) as [{ id: string }];
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    describe('receitas', () => {
        it('AC-0021-13, INV-0021-03: A não lista receita de B e lista a própria', async () => {
            const response = await spaces.a.get('/earnings');

            expect(response.status).toBe(200);
            const ids = response.body.data.map((row: { id: string }) => row.id);
            expect(ids).toContain(a.earningId);
            expect(ids).not.toContain(b.earningId);
        });

        it('AC-0021-13, INV-0021-03, INV-0021-10: A lê a própria receita sem workspaceId e a de B responde EARNING_NOT_FOUND', async () => {
            const own = await spaces.a.get(`/earnings/${a.earningId}`);
            const foreign = await spaces.a.get(`/earnings/${b.earningId}`);
            const missing = await spaces.a.get(`/earnings/${MISSING}`);

            expect(own.status).toBe(200);
            expect(own.body.data).not.toHaveProperty('workspaceId');
            expect(foreign.status).toBe(404);
            expect(foreign.body.error.code).toBe('EARNING_NOT_FOUND');
            expect(foreign.body).toEqual(missing.body);
        });

        it('AC-0021-13: A não altera, não muda o status nem exclui a receita de B', async () => {
            const patch = await spaces.a.patch(`/earnings/${b.earningId}`, { notes: 'x' });
            const following = await spaces.a.patch(`/earnings/${b.earningId}?scope=following`, {
                notes: 'x',
            });
            const status = await spaces.a.patch(`/earnings/${b.earningId}/status`, {
                status: 'VERIFYING',
            });
            const removed = await spaces.a.delete(`/earnings/${b.earningId}`);

            for (const response of [patch, following, status, removed]) {
                expect(response.status).toBe(404);
                expect(response.body.error.code).toBe('EARNING_NOT_FOUND');
            }

            const [row] = (await ctx.dataSource.query(
                'SELECT status, notes FROM earnings WHERE id = $1',
                [b.earningId],
            )) as [{ status: string; notes: string | null }];
            expect(row).toEqual({ status: 'OPEN', notes: null });
        });

        it('AC-0021-13, ERR-0021-01: A não recebe receita de B (saldo de B intacto)', async () => {
            const response = await spaces.a.patch(`/earnings/${b.earningId}/status`, {
                status: 'RECEIVED',
            });

            expect(response.status).toBe(404);
            expect(
                await count('SELECT current_balance_cents AS n FROM bank_accounts WHERE id = $1', [
                    b.accountId,
                ]),
            ).toBe(100);
        });

        it('AC-0021-13, ERR-0021-02: criar receita de A com conta de B responde como conta inexistente', async () => {
            const body = {
                description: 'Salário',
                earningTypeId: typeId,
                kind: 'VARIABLE',
                amountCents: 1000,
                occurredOn: '2026-03-10',
            };
            const foreign = await spaces.a.post('/earnings', {
                ...body,
                bankAccountId: b.accountId,
            });
            const missing = await spaces.a.post('/earnings', { ...body, bankAccountId: MISSING });

            expect(foreign.status).toBe(404);
            expect(foreign.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
            expect(foreign.body).toEqual(missing.body);
        });

        it('AC-0021-13, ERR-0021-02: alterar receita de A para a conta de B responde como conta inexistente', async () => {
            const response = await spaces.a.patch(`/earnings/${a.earningId}`, {
                bankAccountId: b.accountId,
            });

            expect(response.status).toBe(404);
            expect(response.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
        });

        it('AC-0021-13, INV-0021-03: criar receita grava o espaço do contexto', async () => {
            const response = await spaces.a.post('/earnings', {
                description: 'Extra',
                earningTypeId: typeId,
                kind: 'VARIABLE',
                amountCents: 1000,
                occurredOn: '2026-03-10',
                bankAccountId: a.accountId,
            });

            expect(response.status).toBe(201);
            expect(
                await count(
                    'SELECT count(*) AS n FROM earnings WHERE id = $1 AND workspace_id = $2',
                    [response.body.data[0].id, spaces.a.workspaceId],
                ),
            ).toBe(1);
        });
    });

    describe('séries de receita', () => {
        it('AC-0021-13, INV-0021-03: A lista só as próprias séries', async () => {
            const response = await spaces.a.get('/earning-recurrences');

            expect(response.status).toBe(200);
            const ids = response.body.data.map((row: { id: string }) => row.id);
            expect(ids).toContain(a.earningRecurrenceId);
            expect(ids).not.toContain(b.earningRecurrenceId);
        });

        it('AC-0021-13, INV-0021-03: A não lê nem encerra a série de B (EARNING_RECURRENCE_NOT_FOUND)', async () => {
            const read = await spaces.a.get(`/earning-recurrences/${b.earningRecurrenceId}`);
            const end = await spaces.a.patch(`/earning-recurrences/${b.earningRecurrenceId}`, {
                endsOn: '2026-12-31',
            });
            const missing = await spaces.a.get(`/earning-recurrences/${MISSING}`);

            for (const response of [read, end]) {
                expect(response.status).toBe(404);
                expect(response.body.error.code).toBe('EARNING_RECURRENCE_NOT_FOUND');
            }
            expect(read.body).toEqual(missing.body);
            expect(
                await count(
                    'SELECT count(*) AS n FROM earning_recurrences WHERE id = $1 AND ends_on IS NULL',
                    [b.earningRecurrenceId],
                ),
            ).toBe(1);
        });

        it('AC-0021-13: A não exclui a ocorrência de série de B, e a série dela fica', async () => {
            const response = await spaces.a.delete(`/earnings/${b.earningId}`);

            expect(response.status).toBe(404);
            expect(
                await count('SELECT count(*) AS n FROM earning_recurrences WHERE id = $1', [
                    b.earningRecurrenceId,
                ]),
            ).toBe(1);
        });
    });

    describe('jobs (AC-0021-17, INV-0021-06)', () => {
        const ASOF = new Date('2026-04-10T12:00:00.000Z');

        it('AC-0021-17, INV-0021-06: earnings.mark-overdue leva a OVERDUE as receitas vencidas dos dois espaços', async () => {
            expect(await earnings.markOverdue(ASOF)).toBeGreaterThanOrEqual(2);

            for (const id of [a.earningId, b.earningId]) {
                const [row] = (await ctx.dataSource.query(
                    'SELECT status FROM earnings WHERE id = $1',
                    [id],
                )) as [{ status: string }];
                expect(row.status).toBe('OVERDUE');
            }
        });

        it('AC-0021-17, INV-0021-06: earnings.extend-recurrences cria as ocorrências de cada série no espaço dela', async () => {
            expect(await recurrences.extend(ASOF)).toBeGreaterThan(0);

            for (const [recurrenceId, workspaceId] of [
                [a.earningRecurrenceId, spaces.a.workspaceId],
                [b.earningRecurrenceId, spaces.b.workspaceId],
            ] as const) {
                expect(
                    await count(
                        'SELECT count(*) AS n FROM earnings WHERE recurrence_id = $1 AND workspace_id = $2',
                        [recurrenceId, workspaceId],
                    ),
                ).toBeGreaterThan(1);
                expect(
                    await count(
                        'SELECT count(*) AS n FROM earnings WHERE recurrence_id = $1 AND workspace_id <> $2',
                        [recurrenceId, workspaceId],
                    ),
                ).toBe(0);
            }
        });

        it('AC-0021-17, INV-0021-06: earnings.promote-recurrences promove as ocorrências previstas dos dois espaços', async () => {
            const promoted = await recurrences.promote(ASOF);

            expect(promoted).toBeGreaterThanOrEqual(2);
            for (const workspaceId of [spaces.a.workspaceId, spaces.b.workspaceId]) {
                expect(
                    await count(
                        `SELECT count(*) AS n FROM earnings
                         WHERE workspace_id = $1 AND status = 'OPEN' AND recurrence_id IS NOT NULL`,
                        [workspaceId],
                    ),
                ).toBeGreaterThan(0);
                expect(
                    await count(
                        `SELECT count(*) AS n FROM earnings
                         WHERE workspace_id = $1 AND status = 'FORECAST' AND occurred_on <= $2`,
                        [workspaceId, '2026-04-10'],
                    ),
                ).toBe(0);
            }
        });
    });

    describe('tipos de receita: catálogo global (AC-0021-18)', () => {
        it('AC-0021-18, ERR-0021-04: membro ADMIN que não é admin da plataforma lê e recebe 403 ao escrever', async () => {
            const list = await spaces.a.get('/earning-types');
            const fromB = await spaces.b.get('/earning-types');
            const create = await spaces.a.post('/earning-types', { name: 'Tipo A' });
            const patch = await spaces.a.patch(`/earning-types/${typeId}`, { name: 'Tipo A' });
            const archive = await spaces.a.post(`/earning-types/${typeId}/archive`);
            const unarchive = await spaces.a.delete(`/earning-types/${typeId}/archive`);

            expect(list.status).toBe(200);
            expect(fromB.body.data).toEqual(list.body.data);
            for (const response of [create, patch, archive, unarchive]) {
                expect(response.status).toBe(403);
                expect(response.body.error.code).toBe('FORBIDDEN');
            }
        });

        it('AC-0021-18: o admin da plataforma escreve, e A e B veem o mesmo tipo', async () => {
            await ctx.dataSource.query(
                'UPDATE users SET is_platform_admin = true WHERE firebase_uid = $1',
                ['uid-admin-a'],
            );

            const created = await spaces.a.post('/earning-types', { name: 'Tipo Global' });
            const fromA = await spaces.a.get('/earning-types');
            const fromB = await spaces.b.get('/earning-types');

            expect(created.status).toBe(201);
            expect(fromA.body.data.map((t: { id: string }) => t.id)).toContain(
                created.body.data.id,
            );
            expect(fromB.body.data).toEqual(fromA.body.data);
        });
    });
});
