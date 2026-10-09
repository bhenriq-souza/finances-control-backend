import request from 'supertest';

import { stopApp } from '../app.helper';
import { ADMIN, seedReporting, type ReportingFixture } from './reporting-fixtures.helper';

const SCHEMA = 'test_reporting_cash_flow';

type Account = {
    bankAccountId: string;
    inflowsCents: number;
    expensesPaidCents: number;
    statementPaymentsCents: number;
    transfersInCents: number;
    transfersOutCents: number;
    netCents: number;
};

type CashFlowBody = {
    data: {
        from: string;
        to: string;
        months: Array<{ month: string; accounts: Account[]; netCents: number }>;
    };
};

describe('GET /reports/cash-flow (spec 0015, AC-0015-09, emenda da spec 0018)', () => {
    let fx: ReportingFixture;
    let secondId: string;
    let archivedId: string;

    const get = (path: string) => request(fx.ctx.app).get(path).set('Authorization', ADMIN);

    const insertExpense = (status: string, cents: number, occurredOn: string, paidOn?: string) =>
        fx.ctx.dataSource.query(
            `INSERT INTO expenses (description, expense_type_id, kind, status, amount_cents,
                                   occurred_on, paid_on, bank_account_id)
             VALUES ('Despesa', $1, 'VARIABLE', $2, $3::numeric / 100, $4, $5, $6)`,
            [fx.expenseTypeId, status, cents, occurredOn, paidOn ?? null, fx.accountId],
        );

    const insertEarning = (
        status: string,
        cents: number,
        occurredOn: string,
        receivedOn?: string,
    ) =>
        fx.ctx.dataSource.query(
            `INSERT INTO earnings (description, earning_type_id, kind, status, amount_cents,
                                   occurred_on, received_on, bank_account_id)
             VALUES ('Receita', $1, 'VARIABLE', $2, $3::numeric / 100, $4, $5, $6)`,
            [fx.earningTypeId, status, cents, occurredOn, receivedOn ?? null, fx.accountId],
        );

    const insertTransfer = (
        from: string,
        to: string,
        status: string,
        cents: number,
        occurredOn: string,
        completedOn: string | null,
    ) =>
        fx.ctx.dataSource.query(
            `INSERT INTO bank_transfers (from_bank_account_id, to_bank_account_id, amount_cents,
                                         occurred_on, status, completed_on, description)
             VALUES ($1, $2, $3::numeric / 100, $4, $5, $6, 'Transferência')`,
            [from, to, cents, occurredOn, status, completedOn],
        );

    beforeAll(async () => {
        fx = await seedReporting(SCHEMA, 0);

        const bankId = (
            (await fx.ctx.dataSource.query('SELECT id FROM banks LIMIT 1')) as Array<{ id: string }>
        )[0]!.id;
        const create = async (accountNumber: string): Promise<string> => {
            const res = await request(fx.ctx.app)
                .post('/bank-accounts')
                .set('Authorization', ADMIN)
                .send({
                    bankId,
                    type: 'CHECKING',
                    accountNumber,
                    description: `Conta ${accountNumber}`,
                    openingBalanceCents: 0,
                });

            return (res.body as { data: { id: string } }).data.id;
        };

        secondId = await create('2-2');
        archivedId = await create('3-3');
        await fx.ctx.dataSource.query(
            'UPDATE bank_accounts SET archived_at = now() WHERE id = $1',
            [archivedId],
        );

        // Março, conta 1: receita 3000,10 recebida; despesa 1000 paga; despesa OPEN e receita OPEN
        // e FORECAST não aparecem; uma receita recebida em fevereiro (pela data de recebimento).
        await insertEarning('RECEIVED', 300010, '2026-03-01', '2026-03-01');
        await insertEarning('OPEN', 50000, '2026-03-25');
        await insertEarning('FORECAST', 70000, '2026-03-26');
        await insertEarning('RECEIVED', 11100, '2026-03-02', '2026-02-27');
        await insertExpense('PAID', 100000, '2026-03-05', '2026-03-05');
        await insertExpense('OPEN', 25000, '2026-03-20');
        // Paga em abril, ocorrida em março: entra em abril.
        await insertExpense('PAID', 4000, '2026-03-31', '2026-04-02');

        // Despesa de cartão paga (via fatura) não é despesa de conta: sem bank_account_id.
        await fx.ctx.dataSource.query(
            `INSERT INTO expenses (description, expense_type_id, kind, status, amount_cents, occurred_on,
                                   credit_card_id, posted_on)
             VALUES ('Cartão', $1, 'VARIABLE', 'OPEN', 9999::numeric / 100, '2026-03-08', $2, '2026-03-08')`,
            [fx.expenseTypeId, fx.cardId],
        );

        // Pagamento de fatura de 200 em 20/03, debitando a conta 1.
        await fx.ctx.dataSource.query(
            `INSERT INTO credit_card_statement_payments (credit_card_id, bank_account_id, amount_cents, paid_on)
             VALUES ($1, $2, 20000::numeric / 100, '2026-03-20')`,
            [fx.cardId, fx.accountId],
        );

        // Transferência de 700 da conta 1 para a 2, concluída em março; uma agendada não conta;
        // outra concluída em abril.
        await insertTransfer(
            fx.accountId,
            secondId,
            'COMPLETED',
            70000,
            '2026-03-10',
            '2026-03-12',
        );
        await insertTransfer(fx.accountId, secondId, 'SCHEDULED', 90000, '2026-03-15', null);
        await insertTransfer(
            secondId,
            fx.accountId,
            'COMPLETED',
            15050,
            '2026-03-30',
            '2026-04-03',
        );
    });

    afterAll(async () => {
        await stopApp(fx?.ctx, SCHEMA);
    });

    const byAccount = (accounts: Account[], id: string): Account =>
        accounts.find((account) => account.bankAccountId === id)!;

    it('mostra só o realizado de março, por conta, pela data de movimento (AC-0015-09)', async () => {
        const res = await get('/reports/cash-flow?from=2026-03&to=2026-03');

        expect(res.status).toBe(200);

        const { data } = res.body as CashFlowBody;

        expect(data).toMatchObject({ from: '2026-03', to: '2026-03' });
        expect(data.months).toHaveLength(1);

        const march = data.months[0]!;

        expect(byAccount(march.accounts, fx.accountId)).toEqual({
            bankAccountId: fx.accountId,
            inflowsCents: 300010,
            expensesPaidCents: 100000,
            statementPaymentsCents: 20000,
            transfersInCents: 0,
            transfersOutCents: 70000,
            netCents: 300010 - 100000 - 20000 - 70000,
        });
    });

    it('a transferência sai de uma conta e entra na outra, e o net do mês não muda', async () => {
        const res = await get('/reports/cash-flow?from=2026-03&to=2026-03');
        const march = (res.body as CashFlowBody).data.months[0]!;

        expect(byAccount(march.accounts, secondId)).toEqual({
            bankAccountId: secondId,
            inflowsCents: 0,
            expensesPaidCents: 0,
            statementPaymentsCents: 0,
            transfersInCents: 70000,
            transfersOutCents: 0,
            netCents: 70000,
        });
        // Sem a transferência o mês renderia 300010 − 100000 − 20000 = 180010.
        expect(march.netCents).toBe(180010);
        expect(march.accounts.reduce((sum, account) => sum + account.netCents, 0)).toBe(180010);
    });

    it('lista todas as contas, arquivadas inclusive e com zeros, em todos os meses', async () => {
        const res = await get('/reports/cash-flow?from=2026-02&to=2026-04');
        const { months } = (res.body as CashFlowBody).data;

        expect(months.map((m) => m.month)).toEqual(['2026-02', '2026-03', '2026-04']);

        for (const month of months) {
            expect(month.accounts.map((a) => a.bankAccountId)).toEqual([
                fx.accountId,
                secondId,
                archivedId,
            ]);
        }

        expect(byAccount(months[1]!.accounts, archivedId)).toMatchObject({
            inflowsCents: 0,
            netCents: 0,
        });
    });

    it('usa a data de movimento de cada coluna: recebida em fevereiro, paga e transferida em abril', async () => {
        const res = await get('/reports/cash-flow?from=2026-02&to=2026-04');
        const { months } = (res.body as CashFlowBody).data;

        expect(byAccount(months[0]!.accounts, fx.accountId)).toMatchObject({
            inflowsCents: 11100,
            netCents: 11100,
        });
        expect(byAccount(months[2]!.accounts, fx.accountId)).toMatchObject({
            expensesPaidCents: 4000,
            transfersInCents: 15050,
            netCents: 15050 - 4000,
        });
        expect(byAccount(months[2]!.accounts, secondId)).toMatchObject({
            transfersOutCents: 15050,
            netCents: -15050,
        });
        // Transferência anulada entre as contas: o net do mês é só o da despesa.
        expect(months[2]!.netCents).toBe(-4000);
    });

    it('com bankAccountId devolve só aquela conta, e o net do mês é o dela', async () => {
        const res = await get(
            `/reports/cash-flow?from=2026-03&to=2026-03&bankAccountId=${secondId}`,
        );
        const march = (res.body as CashFlowBody).data.months[0]!;

        expect(res.status).toBe(200);
        expect(march.accounts.map((a) => a.bankAccountId)).toEqual([secondId]);
        expect(march.netCents).toBe(70000);
    });

    it('receita OPEN, FORECAST e transferência SCHEDULED nunca entram (INV-0015-05)', async () => {
        const res = await get('/reports/cash-flow?from=2026-03&to=2026-03');
        const march = (res.body as CashFlowBody).data.months[0]!;
        const total = (key: keyof Account) =>
            march.accounts.reduce((sum, account) => sum + (account[key] as number), 0);

        expect(total('inflowsCents')).toBe(300010);
        expect(total('transfersInCents')).toBe(70000);
    });
});
