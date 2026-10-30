import { startApp, stopApp, type TestApp } from '../app.helper';
import { insertDomainRows, type DomainRows } from '../helpers/domain-rows.helper';
import { createTwoWorkspaces, type TwoWorkspaces } from '../helpers/workspaces.helper';

const SCHEMA = 'test_accounts_transfers_isolation';

describe('transferências por espaço (spec 0021, AC-0021-15)', () => {
    let ctx: TestApp;
    let spaces: TwoWorkspaces;
    let a: DomainRows;
    let b: DomainRows;

    const balance = async (id: string): Promise<string> =>
        (
            (await ctx.dataSource.query(
                'SELECT current_balance_cents AS v FROM bank_accounts WHERE id = $1',
                [id],
            )) as [{ v: string }]
        )[0].v;

    const newTransfer = (from: string, to: string) => ({
        fromBankAccountId: from,
        toBankAccountId: to,
        amountCents: 100,
        occurredOn: '2026-10-01',
        description: 'Reserva',
    });

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        spaces = await createTwoWorkspaces(ctx);

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
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    it('AC-0021-15, ERR-0021-02: criar com origem de B por A é BANK_ACCOUNT_NOT_FOUND no campo da origem', async () => {
        const res = await spaces.a.post('/bank-transfers', newTransfer(b.accountId, a.accountId));

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
        expect(res.body.error.details).toMatchObject({ field: 'fromBankAccountId' });
        expect(await balance(a.accountId)).toBe('100.00');
        expect(await balance(b.accountId)).toBe('100.00');
    });

    it('AC-0021-15, ERR-0021-02: criar com destino de B por A é BANK_ACCOUNT_NOT_FOUND no campo do destino, agendada ou concluída', async () => {
        for (const status of ['SCHEDULED', 'COMPLETED']) {
            const res = await spaces.a.post('/bank-transfers', {
                ...newTransfer(a.accountId, b.accountId),
                status,
            });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
            expect(res.body.error.details).toMatchObject({ field: 'toBankAccountId' });
        }
        expect(await balance(a.accountId)).toBe('100.00');
        expect(await balance(b.accountId)).toBe('100.00');
    });

    it('AC-0021-15, ERR-0021-02: criar com as duas contas de A grava a transferência no espaço de A', async () => {
        const res = await spaces.a.post(
            '/bank-transfers',
            newTransfer(a.accountId, a.otherAccountId),
        );

        expect(res.status).toBe(201);
        expect(res.body.data).not.toHaveProperty('workspaceId');
        expect(
            (
                (await ctx.dataSource.query(
                    'SELECT workspace_id AS v FROM bank_transfers WHERE id = $1',
                    [res.body.data.id],
                )) as [{ v: string }]
            )[0].v,
        ).toBe(spaces.a.workspaceId);
    });

    it('AC-0021-15, INV-0021-03: ler, alterar, concluir e excluir transferência de B por A são BANK_TRANSFER_NOT_FOUND', async () => {
        const responses = [
            await spaces.a.get(`/bank-transfers/${b.transferId}`),
            await spaces.a.patch(`/bank-transfers/${b.transferId}`, { description: 'x' }),
            await spaces.a.patch(`/bank-transfers/${b.transferId}/status`, { status: 'COMPLETED' }),
            await spaces.a.delete(`/bank-transfers/${b.transferId}`),
        ];

        for (const res of responses) {
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('BANK_TRANSFER_NOT_FOUND');
        }
        expect(
            (
                (await ctx.dataSource.query(
                    'SELECT status AS v, description AS d FROM bank_transfers WHERE id = $1',
                    [b.transferId],
                )) as [{ v: string; d: string }]
            )[0],
        ).toEqual({ v: 'SCHEDULED', d: 'Reserva' });
        expect(await balance(b.accountId)).toBe('100.00');
        expect(await balance(b.otherAccountId)).toBe('100.00');
    });

    it('AC-0021-15, ERR-0021-02: trocar a conta de transferência de A por conta de B é BANK_ACCOUNT_NOT_FOUND', async () => {
        const res = await spaces.a.patch(`/bank-transfers/${a.transferId}`, {
            toBankAccountId: b.accountId,
        });

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
        expect(res.body.error.details).toMatchObject({ field: 'toBankAccountId' });
    });

    it('AC-0021-15, INV-0021-03: a lista de A não contém transferência de B, nem filtrando pela conta de B', async () => {
        const all = await spaces.a.get('/bank-transfers');
        const byAccount = await spaces.a.get(`/bank-transfers?bankAccountId=${b.accountId}`);

        expect(all.status).toBe(200);
        expect(JSON.stringify(all.body)).toContain(a.transferId);
        expect(JSON.stringify(all.body)).not.toContain(b.transferId);
        expect(byAccount.body.data).toEqual([]);
    });

    it('AC-0021-15: A conclui a própria transferência e só as contas de A se movem', async () => {
        const res = await spaces.a.patch(`/bank-transfers/${a.transferId}/status`, {
            status: 'COMPLETED',
        });

        expect(res.status).toBe(200);
        expect(await balance(b.accountId)).toBe('100.00');
    });
});
