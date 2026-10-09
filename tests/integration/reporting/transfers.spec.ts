import request from 'supertest';

import { stopApp } from '../app.helper';
import {
    ADMIN,
    DATE_ONLY,
    currentBalanceCents,
    getBalance,
    seedReporting,
    type BalancePointBody,
    type ReportingFixture,
} from './reporting-fixtures.helper';

const SCHEMA = 'test_reporting_transfers';

type ByTypeBody = { data: { months: Array<{ totalCents: number; byType: unknown[] }> } };
type CashFlowBody = {
    data: {
        months: Array<{
            accounts: Array<{
                bankAccountId: string;
                transfersInCents: number;
                transfersOutCents: number;
                netCents: number;
            }>;
            netCents: number;
        }>;
    };
};

describe('transferências nos relatórios (spec 0018, AC-0018-08 a AC-0018-10, INV-0018-07)', () => {
    let fx: ReportingFixture;
    let accountB: string;

    const get = (path: string) => request(fx.ctx.app).get(path).set('Authorization', ADMIN);

    const transfer = async (body: Record<string, unknown>): Promise<void> => {
        const res = await request(fx.ctx.app)
            .post('/bank-transfers')
            .set('Authorization', ADMIN)
            .send({ fromBankAccountId: fx.accountId, toBankAccountId: accountB, ...body });

        if (res.status !== 201) throw new Error(`transfer failed: ${JSON.stringify(res.body)}`);
    };

    const balanceOf = async (id: string): Promise<number> => {
        const rows = (await fx.ctx.dataSource.query(
            'SELECT (current_balance_cents * 100)::bigint::text AS cents FROM bank_accounts WHERE id = $1',
            [id],
        )) as Array<{ cents: string }>;

        return Number(rows[0]!.cents);
    };

    const of = (point: BalancePointBody | undefined, id: string): number | undefined =>
        point?.accounts.find((a) => a.bankAccountId === id)?.balanceCents;

    beforeAll(async () => {
        fx = await seedReporting(SCHEMA, 100000);

        const bankId = (
            (await fx.ctx.dataSource.query('SELECT id FROM banks LIMIT 1')) as Array<{ id: string }>
        )[0]!.id;
        const res = await request(fx.ctx.app)
            .post('/bank-accounts')
            .set('Authorization', ADMIN)
            .send({
                bankId,
                type: 'CHECKING',
                accountNumber: '2-2',
                description: 'Conta B',
                openingBalanceCents: 5000,
            });

        accountB = (res.body as { data: { id: string } }).data.id;
        jest.useFakeTimers({
            now: new Date('2026-04-15T15:00:00.000Z'),
            doNotFake: [...DATE_ONLY],
        });
    });

    afterAll(async () => {
        jest.useRealTimers();
        await stopApp(fx?.ctx, SCHEMA);
    });

    it('AC-0018-08: 300 concluída em 10/03 move o realizado de A e B, igual ao saldo corrente', async () => {
        const [untouched] = await getBalance(fx, '2026-03', '2026-03');

        expect(of(untouched, fx.accountId)).toBe(100000);
        expect(of(untouched, accountB)).toBe(5000);

        await transfer({
            amountCents: 30000,
            occurredOn: '2026-03-10',
            status: 'COMPLETED',
            completedOn: '2026-03-10',
            description: 'Reserva',
        });

        const [march] = await getBalance(fx, '2026-03', '2026-03');

        expect(march).toMatchObject({ month: '2026-03', kind: 'REALIZED' });
        expect(of(march, fx.accountId)).toBe(70000);
        expect(of(march, accountB)).toBe(35000);
        expect(of(march, fx.accountId)).toBe(await currentBalanceCents(fx));
        expect(of(march, accountB)).toBe(await balanceOf(accountB));
    });

    it('AC-0018-09: agendada de 200 em maio reduz o previsto de A, aumenta o de B e mantém o consolidado', async () => {
        const beforeMay = (await getBalance(fx, '2026-03', '2026-05'))[2];

        await transfer({
            amountCents: 20000,
            occurredOn: '2026-05-10',
            status: 'SCHEDULED',
            description: 'Futura',
        });

        const [, april, may] = await getBalance(fx, '2026-03', '2026-05');

        expect(may).toMatchObject({ month: '2026-05', kind: 'FORECAST' });
        expect(of(beforeMay, fx.accountId)).toBe(70000);
        expect(of(may, fx.accountId)).toBe(50000);
        expect(of(beforeMay, accountB)).toBe(35000);
        expect(of(may, accountB)).toBe(55000);
        expect(may!.consolidatedCents).toBe(beforeMay!.consolidatedCents);
        // O mês anterior à data da agendada não muda.
        expect(of(april, fx.accountId)).toBe(70000);
        expect(of(april, accountB)).toBe(35000);
    });

    it('AC-0018-10 e INV-0018-07: o fluxo de caixa mostra a transferência; os relatórios por tipo não', async () => {
        const cash = (await get('/reports/cash-flow?from=2026-03&to=2026-03')).body as CashFlowBody;
        const month = cash.data.months[0]!;
        const a = month.accounts.find((x) => x.bankAccountId === fx.accountId);
        const b = month.accounts.find((x) => x.bankAccountId === accountB);

        expect(a).toMatchObject({
            transfersOutCents: 30000,
            transfersInCents: 0,
            netCents: -30000,
        });
        expect(b).toMatchObject({ transfersOutCents: 0, transfersInCents: 30000, netCents: 30000 });
        expect(month.netCents).toBe(0);

        for (const path of ['expenses-by-type', 'earnings-by-type']) {
            const res = await get(`/reports/${path}?from=2026-03&to=2026-05&includeForecast=true`);
            const body = res.body as ByTypeBody;

            expect(res.status).toBe(200);

            for (const m of body.data.months) {
                expect(m.totalCents).toBe(0);
                expect(m.byType).toEqual([]);
            }
        }
    });
});
