import { stopApp, startApp, type TestApp } from '../app.helper';
import { createTwoWorkspaces, type TwoWorkspaces } from '../helpers/workspaces.helper';
import { DATE_ONLY } from './reporting-fixtures.helper';

const SCHEMA = 'test_reporting_isolation';

type Side = {
    accountId: string;
    secondAccountId: string;
    cardId: string;
};

/** Amounts of space B are 1000 times those of space A, so any leak shows in the totals. */
const SCALE = { a: 1, b: 1000 } as const;

describe('relatórios por espaço (spec 0021, AC-0021-16, INV-0021-03, ERR-0021-01)', () => {
    let ctx: TestApp;
    let spaces: TwoWorkspaces;
    let sides: { a: Side; b: Side };
    let expenseTypeId: string;
    let earningTypeId: string;

    const query = (sql: string, params: unknown[]) => ctx.dataSource.query(sql, params);

    const insertSide = async (
        workspaceId: string,
        tag: string,
        bankId: string,
        k: number,
    ): Promise<Side> => {
        const account = async (number: string, cents: number): Promise<string> =>
            (
                (await query(
                    `INSERT INTO bank_accounts (workspace_id, bank_id, type, account_number, description,
                                                opening_balance_cents, current_balance_cents)
                     VALUES ($1, $2, 'CHECKING', $3, $4, $5::numeric / 100, $5::numeric / 100)
                     RETURNING id`,
                    [workspaceId, bankId, `${tag}-${number}`, `Conta ${tag} ${number}`, cents],
                )) as { id: string }[]
            )[0]!.id;
        // Opening 1000,00 + 500,00 received - 200,00 paid = current balance 1300,00 (times k).
        const accountId = await account('1', 100000 * k);
        const secondAccountId = await account('2', 0);

        await query(
            'UPDATE bank_accounts SET current_balance_cents = $2::numeric / 100 WHERE id = $1',
            [accountId, 130000 * k],
        );

        const cardId = (
            (await query(
                `INSERT INTO credit_cards (workspace_id, bank_id, name, credit_limit_cents,
                                           available_limit_cents, closing_day, due_day, created_at,
                                           payment_bank_account_id)
                 VALUES ($1, $2, $3, 500, 500, 10, 20, '2026-01-15T12:00:00Z', $4)
                 RETURNING id`,
                [workspaceId, bankId, `Cartão ${tag}`, accountId],
            )) as { id: string }[]
        )[0]!.id;

        const earning = (status: string, cents: number, on: string) =>
            query(
                `INSERT INTO earnings (workspace_id, description, earning_type_id, kind, status,
                                       amount_cents, occurred_on, received_on, bank_account_id)
                 VALUES ($1, 'Receita', $2, 'VARIABLE', $3, $4::numeric / 100, $5::date,
                         CASE WHEN $3 = 'RECEIVED' THEN $5::date END, $6)`,
                [workspaceId, earningTypeId, status, cents, on, accountId],
            );
        const expense = (status: string, cents: number, on: string) =>
            query(
                `INSERT INTO expenses (workspace_id, description, expense_type_id, kind, status,
                                       amount_cents, occurred_on, paid_on, bank_account_id)
                 VALUES ($1, 'Despesa', $2, 'VARIABLE', $3, $4::numeric / 100, $5::date,
                         CASE WHEN $3 = 'PAID' THEN $5::date END, $6)`,
                [workspaceId, expenseTypeId, status, cents, on, accountId],
            );

        await earning('RECEIVED', 50000 * k, '2026-03-10');
        await expense('PAID', 20000 * k, '2026-03-15');
        // Pending in April: enters the forecast only.
        await earning('OPEN', 30000 * k, '2026-04-10');
        await expense('OPEN', 10000 * k, '2026-04-12');
        // A card purchase and a refund in March.
        await query(
            `INSERT INTO expenses (workspace_id, description, expense_type_id, kind, status,
                                   amount_cents, occurred_on, credit_card_id, posted_on)
             VALUES ($1, 'Compra', $2, 'VARIABLE', 'OPEN', $3::numeric / 100, '2026-03-03', $4,
                     '2026-03-03')`,
            [workspaceId, expenseTypeId, 40000 * k, cardId],
        );
        await query(
            `INSERT INTO credit_card_refunds (workspace_id, credit_card_id, description,
                                              amount_cents, occurred_on, posted_on)
             VALUES ($1, $2, 'Estorno', $3::numeric / 100, '2026-03-05', '2026-03-05')`,
            [workspaceId, cardId, 500 * k],
        );
        // A completed transfer between the space's own accounts.
        await query(
            `INSERT INTO bank_transfers (workspace_id, from_bank_account_id, to_bank_account_id,
                                         amount_cents, occurred_on, completed_on, status, description)
             VALUES ($1, $2, $3, $4::numeric / 100, '2026-03-20', '2026-03-20', 'COMPLETED', 'Reserva')`,
            [workspaceId, accountId, secondAccountId, 1000 * k],
        );

        return { accountId, secondAccountId, cardId };
    };

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        spaces = await createTwoWorkspaces(ctx);

        const [bank] = (await query(
            "INSERT INTO banks (febraban_code, name) VALUES ('260', 'Nu Pagamentos') RETURNING id",
            [],
        )) as [{ id: string }];

        expenseTypeId = (
            (await query('SELECT id FROM expense_types ORDER BY name LIMIT 1', [])) as {
                id: string;
            }[]
        )[0]!.id;
        earningTypeId = (
            (await query('SELECT id FROM earning_types ORDER BY name LIMIT 1', [])) as {
                id: string;
            }[]
        )[0]!.id;

        sides = {
            a: await insertSide(spaces.a.workspaceId, 'A', bank.id, SCALE.a),
            b: await insertSide(spaces.b.workspaceId, 'B', bank.id, SCALE.b),
        };

        jest.useFakeTimers({
            now: new Date('2026-03-31T15:00:00.000Z'),
            doNotFake: [...DATE_ONLY],
        });
    });

    afterAll(async () => {
        jest.useRealTimers();
        await stopApp(ctx, SCHEMA);
    });

    type Data<T> = { data: T };

    it('AC-0021-16: GET /reports/expenses-by-type soma só o espaço de quem pede', async () => {
        const path = '/reports/expenses-by-type?from=2026-03&to=2026-03';
        const a = (await spaces.a.get(path)).body as Data<{
            months: Array<{ totalCents: number; refundsCents: number }>;
        }>;
        const b = (await spaces.b.get(path)).body as Data<{
            months: Array<{ totalCents: number; refundsCents: number }>;
        }>;

        // 200,00 paid + 400,00 card purchase; refunds 5,00.
        expect(a.data.months[0]).toMatchObject({ totalCents: 60000, refundsCents: 500 });
        expect(b.data.months[0]).toMatchObject({ totalCents: 60000000, refundsCents: 500000 });
    });

    it('AC-0021-16: GET /reports/earnings-by-type soma só o espaço de quem pede', async () => {
        const path = '/reports/earnings-by-type?from=2026-03&to=2026-03';
        const a = (await spaces.a.get(path)).body as Data<{
            months: Array<{ totalCents: number }>;
        }>;
        const b = (await spaces.b.get(path)).body as Data<{
            months: Array<{ totalCents: number }>;
        }>;

        expect(a.data.months[0]!.totalCents).toBe(50000);
        expect(b.data.months[0]!.totalCents).toBe(50000000);
    });

    it('AC-0021-16: GET /reports/cash-flow lista só as contas do espaço e soma só o dele', async () => {
        const path = '/reports/cash-flow?from=2026-03&to=2026-03';
        type Body = Data<{
            months: Array<{
                netCents: number;
                accounts: Array<{ bankAccountId: string; inflowsCents: number }>;
            }>;
        }>;
        const a = (await spaces.a.get(path)).body as Body;
        const b = (await spaces.b.get(path)).body as Body;

        expect(a.data.months[0]!.accounts.map((x) => x.bankAccountId).sort()).toEqual(
            [sides.a.accountId, sides.a.secondAccountId].sort(),
        );
        expect(b.data.months[0]!.accounts.map((x) => x.bankAccountId).sort()).toEqual(
            [sides.b.accountId, sides.b.secondAccountId].sort(),
        );
        // 500,00 in - 200,00 out; the transfer nets to zero across the space's accounts.
        expect(a.data.months[0]!.netCents).toBe(30000);
        expect(b.data.months[0]!.netCents).toBe(30000000);
    });

    it('AC-0021-16: GET /reports/balance traz só as contas e os saldos do espaço', async () => {
        const path = '/reports/balance?from=2026-03&to=2026-04';
        type Body = Data<{
            points: Array<{
                month: string;
                accountsTotalCents: number;
                cardDebtCents: number | null;
                accounts: Array<{ bankAccountId: string; balanceCents: number }>;
            }>;
        }>;
        const a = (await spaces.a.get(path)).body as Body;
        const b = (await spaces.b.get(path)).body as Body;

        for (const [body, side] of [
            [a, sides.a],
            [b, sides.b],
        ] as const) {
            for (const point of body.data.points) {
                expect(point.accounts.map((x) => x.bankAccountId).sort()).toEqual(
                    [side.accountId, side.secondAccountId].sort(),
                );
            }
        }
        const april = (body: Body) => body.data.points.find((p) => p.month === '2026-04')!;

        // 1300,00 current + 300,00 pending earning - 100,00 pending expense.
        expect(april(a).accountsTotalCents).toBe(150000);
        expect(april(b).accountsTotalCents).toBe(150000000);
        expect(april(a).cardDebtCents).toBeGreaterThan(0);
        expect(april(b).cardDebtCents).toBe(1000 * april(a).cardDebtCents!);
    });

    it('AC-0021-16: GET /reports/account-movements soma só os lançamentos da conta do espaço', async () => {
        const path = (id: string) =>
            `/reports/account-movements?bankAccountId=${id}&from=2026-03-01&to=2026-03-31`;
        type Body = Data<{
            openingBalanceCents: number;
            closingBalanceCents: number;
            movements: unknown[];
        }>;
        const a = (await spaces.a.get(path(sides.a.accountId))).body as Body;
        const b = (await spaces.b.get(path(sides.b.accountId))).body as Body;

        // earning, expense and the outgoing transfer.
        expect(a.data.movements).toHaveLength(3);
        expect(a.data.openingBalanceCents).toBe(100000);
        expect(a.data.closingBalanceCents).toBe(100000 + 50000 - 20000 - 1000);
        expect(b.data.openingBalanceCents).toBe(100000000);
        expect(b.data.closingBalanceCents).toBe(1000 * (100000 + 50000 - 20000 - 1000));
    });

    it('INV-0021-03, ERR-0021-01: conta de outro espaço nos relatórios responde como inexistente', async () => {
        const missing = '00000000-0000-4000-8000-000000000000';
        const paths = (id: string) => [
            `/reports/balance?from=2026-03&to=2026-04&bankAccountId=${id}`,
            `/reports/cash-flow?from=2026-03&to=2026-03&bankAccountId=${id}`,
            `/reports/account-movements?bankAccountId=${id}&from=2026-03-01&to=2026-03-31`,
        ];

        for (const [foreign, unknown] of zip(paths(sides.b.accountId), paths(missing))) {
            const fromA = await spaces.a.get(foreign);
            const nothing = await spaces.a.get(unknown);

            expect(fromA.status).toBe(404);
            expect(fromA.body).toEqual(nothing.body);
            expect(JSON.stringify(fromA.body)).toContain('BANK_ACCOUNT_NOT_FOUND');
        }
    });

    it('INV-0021-10: nenhum relatório devolve workspaceId', async () => {
        const res = await spaces.a.get('/reports/cash-flow?from=2026-03&to=2026-03');

        expect(JSON.stringify(res.body)).not.toMatch(/workspace/i);
    });
});

function zip<T>(left: T[], right: T[]): Array<[T, T]> {
    return left.map((item, index): [T, T] => [item, right[index]!]);
}
