import request from 'supertest';

import { stopApp } from '../app.helper';
import {
    ADMIN,
    DATE_ONLY,
    addAccount,
    currentBalanceCents,
    payExpense,
    payStatement,
    receiveEarning,
    seedReporting,
    type ReportingFixture,
} from './reporting-fixtures.helper';

const SCHEMA = 'test_reporting_account_movements';

type Movement = {
    date: string;
    kind: string;
    sourceId: string;
    description: string | null;
    typeName: string | null;
    creditCardId: string | null;
    statementId: string | null;
    counterpartBankAccountId: string | null;
    amountCents: number;
    balanceAfterCents: number;
};

type Statement = {
    bankAccountId: string;
    from: string;
    to: string;
    openingBalanceCents: number;
    closingBalanceCents: number;
    movements: Movement[];
};

describe('GET /reports/account-movements (spec 0015, AC-0015-14, AC-0015-15, INV-0015-08)', () => {
    let fx: ReportingFixture;
    let otherId: string;

    const statement = async (id: string, from: string, to: string): Promise<Statement> => {
        const res = await request(fx.ctx.app)
            .get(`/reports/account-movements?bankAccountId=${id}&from=${from}&to=${to}`)
            .set('Authorization', ADMIN);

        if (res.status !== 200) throw new Error(`statement failed: ${JSON.stringify(res.body)}`);

        return (res.body as { data: Statement }).data;
    };

    const transfer = async (
        from: string,
        to: string,
        amountCents: number,
        status: 'COMPLETED' | 'SCHEDULED',
        on: string,
        description = 'Transferência',
    ): Promise<void> => {
        const res = await request(fx.ctx.app)
            .post('/bank-transfers')
            .set('Authorization', ADMIN)
            .send({
                fromBankAccountId: from,
                toBankAccountId: to,
                amountCents,
                occurredOn: on,
                status,
                ...(status === 'COMPLETED' ? { completedOn: on } : {}),
                description,
            });

        if (res.status !== 201) throw new Error(`transfer failed: ${JSON.stringify(res.body)}`);
    };

    beforeAll(async () => {
        fx = await seedReporting(SCHEMA, 100000);
        otherId = await addAccount(fx, '9-9', 0);
        jest.useFakeTimers({
            now: new Date('2026-03-31T15:00:00.000Z'),
            doNotFake: [...DATE_ONLY],
        });
    });

    afterAll(async () => {
        jest.useRealTimers();
        await stopApp(fx?.ctx, SCHEMA);
    });

    it('AC-0015-14: abertura 1050, +500, −200, −100, −300 e fechamento 950 = saldo corrente', async () => {
        await receiveEarning(fx, 5000, '2026-02-20');
        await receiveEarning(fx, 50000, '2026-03-10');
        await payExpense(fx, 20000, '2026-03-15');
        await payStatement(fx, 10000, '2026-03-20');
        await transfer(fx.accountId, otherId, 30000, 'COMPLETED', '2026-03-25', 'Reserva');

        const report = await statement(fx.accountId, '2026-03-01', '2026-03-31');

        expect(report).toMatchObject({
            bankAccountId: fx.accountId,
            from: '2026-03-01',
            to: '2026-03-31',
            openingBalanceCents: 105000,
            closingBalanceCents: 95000,
        });
        expect(
            report.movements.map((m) => [m.date, m.kind, m.amountCents, m.balanceAfterCents]),
        ).toEqual([
            ['2026-03-10', 'EARNING', 50000, 155000],
            ['2026-03-15', 'EXPENSE', -20000, 135000],
            ['2026-03-20', 'STATEMENT_PAYMENT', -10000, 125000],
            ['2026-03-25', 'TRANSFER_OUT', -30000, 95000],
        ]);
        expect(report.closingBalanceCents).toBe(await currentBalanceCents(fx));
    });

    it('preenche os campos de cada tipo e deixa null os que não se aplicam', async () => {
        const { movements } = await statement(fx.accountId, '2026-03-01', '2026-03-31');
        const [earning, expense, payment, out] = movements as [
            Movement,
            Movement,
            Movement,
            Movement,
        ];

        expect(earning).toMatchObject({
            description: 'Receita',
            typeName: 'T-Salário',
            creditCardId: null,
            statementId: null,
            counterpartBankAccountId: null,
        });
        expect(expense).toMatchObject({
            description: 'Despesa',
            typeName: 'T-Mercado',
            creditCardId: null,
            statementId: null,
            counterpartBankAccountId: null,
        });
        expect(payment).toMatchObject({
            description: null,
            typeName: null,
            creditCardId: fx.cardId,
            counterpartBankAccountId: null,
        });
        expect(payment.statementId).toEqual(expect.any(String));
        expect(out).toMatchObject({
            description: 'Reserva',
            typeName: null,
            creditCardId: null,
            statementId: null,
            counterpartBankAccountId: otherId,
        });
        for (const movement of movements) {
            expect(Object.keys(movement).sort()).toEqual(Object.keys(earning).sort());
        }
    });

    it('a transferência recebida aparece como TRANSFER_IN, com a contraparte', async () => {
        const report = await statement(otherId, '2026-03-01', '2026-03-31');

        expect(report.openingBalanceCents).toBe(0);
        expect(report.closingBalanceCents).toBe(30000);
        expect(report.movements).toHaveLength(1);
        expect(report.movements[0]).toMatchObject({
            kind: 'TRANSFER_IN',
            amountCents: 30000,
            balanceAfterCents: 30000,
            counterpartBankAccountId: fx.accountId,
        });
    });

    it('AC-0015-15: pendências, agendada e despesa de cartão não aparecem; mesmo dia sai na ordem de criação; conta arquivada tem extrato', async () => {
        const account = await addAccount(fx, '8-8', 100000);
        const insert = async (sql: string, params: unknown[]): Promise<void> => {
            await fx.ctx.dataSource.query(sql, params);
        };
        const earning = (status: string, cents: number, description: string) =>
            insert(
                `INSERT INTO earnings (description, earning_type_id, kind, status, amount_cents,
                                       occurred_on, received_on, bank_account_id)
                 VALUES ($5, $1, 'VARIABLE', $2, $3::numeric / 100, '2026-03-12',
                         CASE WHEN $2 = 'RECEIVED' THEN '2026-03-12'::date END, $4)`,
                [fx.earningTypeId, status, cents, account, description],
            );

        // Inseridas em ordem de criação; o id não coincide com ela, então só `created_at` ordena.
        await earning('RECEIVED', 1100, 'Primeira');
        await earning('OPEN', 9900, 'Aberta');
        await earning('FORECAST', 9800, 'Prevista');
        await earning('RECEIVED', 2200, 'Segunda');
        await earning('RECEIVED', 3300, 'Terceira');
        await insert(
            `INSERT INTO expenses (description, expense_type_id, kind, status, amount_cents,
                                   occurred_on, credit_card_id, posted_on)
             VALUES ('Cartão', $1, 'VARIABLE', 'OPEN', 77.77, '2026-03-12', $2, '2026-03-12')`,
            [fx.expenseTypeId, fx.cardId],
        );
        await insert(
            `INSERT INTO bank_transfers (from_bank_account_id, to_bank_account_id, amount_cents,
                                         occurred_on, status, description)
             VALUES ($1, $2, 500, '2026-03-12', 'SCHEDULED', 'Agendada')`,
            [account, otherId],
        );
        // Pagamento antecipado ainda sem fatura.
        await insert(
            `INSERT INTO credit_card_statement_payments (credit_card_id, bank_account_id, amount_cents, paid_on)
             VALUES ($1, $2, 10, '2026-03-13')`,
            [fx.cardId, account],
        );
        await insert('UPDATE bank_accounts SET archived_at = now() WHERE id = $1', [account]);

        const report = await statement(account, '2026-03-01', '2026-03-31');

        expect(report.movements.map((m) => m.description)).toEqual([
            'Primeira',
            'Segunda',
            'Terceira',
            null,
        ]);
        expect(report.movements[3]).toMatchObject({
            kind: 'STATEMENT_PAYMENT',
            creditCardId: fx.cardId,
            statementId: null,
            amountCents: -1000,
        });
        expect(report.openingBalanceCents).toBe(100000);
        expect(report.closingBalanceCents).toBe(100000 + 1100 + 2200 + 3300 - 1000);
        expect(report.movements.at(-1)!.balanceAfterCents).toBe(report.closingBalanceCents);
    });

    it('janela sem movimentos devolve abertura igual ao fechamento', async () => {
        const report = await statement(fx.accountId, '2026-06-01', '2026-06-30');

        expect(report.movements).toEqual([]);
        expect(report.openingBalanceCents).toBe(95000);
        expect(report.closingBalanceCents).toBe(95000);
    });

    it('INV-0015-08: abertura + Σ amount = fechamento = saldo corrente, em qualquer janela', async () => {
        const account = await addAccount(fx, '7-7', 123456);
        let seed = 20261013;
        const next = (limit: number): number => {
            seed = (seed * 1103515245 + 12345) % 2147483648;

            return seed % limit;
        };
        const day = (): string => `2026-0${1 + next(3)}-${String(1 + next(27)).padStart(2, '0')}`;

        const earn = async (cents: number, on: string) => {
            const created = await request(fx.ctx.app)
                .post('/earnings')
                .set('Authorization', ADMIN)
                .send({
                    description: 'Receita',
                    earningTypeId: fx.earningTypeId,
                    kind: 'VARIABLE',
                    amountCents: cents,
                    occurredOn: on,
                    bankAccountId: account,
                });
            const id = (created.body as { data: Array<{ id: string }> }).data[0]!.id;
            const res = await request(fx.ctx.app)
                .patch(`/earnings/${id}/status`)
                .set('Authorization', ADMIN)
                .send({ status: 'RECEIVED', receivedOn: on });

            expect(res.status).toBe(200);
        };
        const spend = async (cents: number, on: string) => {
            const created = await request(fx.ctx.app)
                .post('/expenses')
                .set('Authorization', ADMIN)
                .send({
                    description: 'Despesa',
                    expenseTypeId: fx.expenseTypeId,
                    kind: 'VARIABLE',
                    amountCents: cents,
                    occurredOn: on,
                    bankAccountId: account,
                });
            const id = (created.body as { data: Array<{ id: string }> }).data[0]!.id;
            const res = await request(fx.ctx.app)
                .patch(`/expenses/${id}/status`)
                .set('Authorization', ADMIN)
                .send({ status: 'PAID', paidOn: on });

            expect(res.status).toBe(200);
        };

        for (let i = 0; i < 24; i += 1) {
            const cents = 1 + next(90000);

            switch (i % 4) {
                case 0:
                    await earn(cents, day());
                    break;
                case 1:
                    await spend(cents, day());
                    break;
                case 2:
                    await transfer(account, otherId, cents, 'COMPLETED', day());
                    break;
                default:
                    await transfer(otherId, account, cents, 'COMPLETED', day());
            }
        }

        const sum = (report: Statement): number =>
            report.movements.reduce((total, m) => total + m.amountCents, 0);
        const all = await statement(account, '2026-01-01', '2026-03-31');

        expect(all.movements).toHaveLength(24);
        expect(all.openingBalanceCents).toBe(123456);
        expect(all.openingBalanceCents + sum(all)).toBe(all.closingBalanceCents);
        expect(all.closingBalanceCents).toBe(await balanceOf(account));
        expect(all.movements.at(-1)!.balanceAfterCents).toBe(all.closingBalanceCents);

        for (const [from, to] of [
            ['2026-01-01', '2026-01-31'],
            ['2026-02-01', '2026-02-28'],
            ['2026-03-01', '2026-03-31'],
            ['2026-01-15', '2026-03-05'],
        ] as const) {
            const part = await statement(account, from, to);

            expect(part.openingBalanceCents + sum(part)).toBe(part.closingBalanceCents);
            expect(part.movements.map((m) => m.balanceAfterCents)).toEqual(
                part.movements.reduce<number[]>((acc, m) => {
                    acc.push((acc.at(-1) ?? part.openingBalanceCents) + m.amountCents);

                    return acc;
                }, []),
            );
        }
    }, 60_000);

    const balanceOf = async (id: string): Promise<number> => {
        const rows = (await fx.ctx.dataSource.query(
            'SELECT (current_balance_cents * 100)::bigint::text AS cents FROM bank_accounts WHERE id = $1',
            [id],
        )) as Array<{ cents: string }>;

        return Number(rows[0]!.cents);
    };
});
