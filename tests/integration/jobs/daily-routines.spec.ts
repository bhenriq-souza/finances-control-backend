import { container } from '../../../src/container';
import { EarningJobs } from '../../../src/earnings';
import { ExpenseJobs } from '../../../src/expenses';
import { ExpenseServiceSymbol, type ExpenseService } from '../../../src/expenses';
import type { JobHandler, JobQueue, JobRegistrar } from '../../../src/platform';
import { StatementJobs } from '../../../src/statements';
import { startApp, stopApp, type TestApp } from '../app.helper';
import { cleanFixture, insertExpense, seedFixture, type Fixture } from '../expenses/fixture.helper';

const SCHEMA = 'test_jobs_daily_routines';
const CRON = '15 0 * * *';
const JOBS = ['statements.close-due', 'expenses.mark-overdue', 'earnings.mark-overdue'];

/** Só `Date` é falsificado: o driver do Postgres precisa dos timers reais. */
const FAKE_ONLY_DATE = [
    'hrtime',
    'nextTick',
    'performance',
    'queueMicrotask',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'requestIdleCallback',
    'cancelIdleCallback',
    'setImmediate',
    'clearImmediate',
    'setInterval',
    'clearInterval',
    'setTimeout',
    'clearTimeout',
] as const;

type Snapshot = {
    expenses: unknown[];
    earnings: unknown[];
    statements: unknown[];
    accountBalance: unknown;
    cardLimit: unknown;
};

describe('rotinas diárias (spec 0017, AC-0017-13, INV-0017-01, INV-0017-02)', () => {
    let ctx: TestApp;
    let fixture: Fixture;
    let earningTypeId: string;
    const handlers = new Map<string, JobHandler>();
    const schedules = new Map<string, string>();

    const queue: JobQueue = {
        register: (name, handler) => {
            handlers.set(name, handler as unknown as JobHandler);
        },
        schedule: (name, cron) => {
            schedules.set(name, cron);
        },
        enqueue: () => Promise.reject(new Error('not used')),
    };

    const runAt = async (iso: string, names: string[] = JOBS): Promise<void> => {
        // 00h15 no fuso de negócio (UTC-3) = 03h15 UTC.
        jest.useFakeTimers({
            now: new Date(`${iso}T03:15:00.000Z`),
            doNotFake: [...FAKE_ONLY_DATE],
        });

        try {
            for (const name of names) {
                await handlers.get(name)!({ id: `job-${name}`, name, payload: {}, attempt: 1 });
            }
        } finally {
            jest.useRealTimers();
        }
    };

    const seedScenario = async (): Promise<void> => {
        const { accountId, cardId, typeId } = fixture;
        const line = (description: string, occurredOn: string, extra = {}) =>
            insertExpense(ctx, { typeId, accountId, occurredOn, ...extra }).then((id) =>
                ctx.dataSource.query('UPDATE expenses SET description = $2 WHERE id = $1', [
                    id,
                    description,
                ]),
            );

        await line('exp-open-10', '2026-03-10');
        await line('exp-open-12', '2026-03-12');
        await line('exp-open-13', '2026-03-13');
        await line('exp-paid-10', '2026-03-10', { status: 'PAID' });
        await line('exp-card-10', '2026-03-10', { cardId, accountId: undefined });

        const earning = (description: string, status: string, occurredOn: string) =>
            ctx.dataSource.query(
                `INSERT INTO earnings (description, earning_type_id, kind, status, amount_cents,
                    occurred_on, received_on, bank_account_id)
                 VALUES ($1, $2, 'VARIABLE', $3, 50, $4::date, $5::date, $6)`,
                [
                    description,
                    earningTypeId,
                    status,
                    occurredOn,
                    status === 'RECEIVED' ? occurredOn : null,
                    accountId,
                ],
            );

        await earning('earn-open-10', 'OPEN', '2026-03-10');
        await earning('earn-open-12', 'OPEN', '2026-03-12');
        await earning('earn-open-13', 'OPEN', '2026-03-13');
        await earning('earn-received-10', 'RECEIVED', '2026-03-10');

        // Cadastrado em 15/01 com fechamento no dia 12: fecha em 12/02 e em 12/03.
        await ctx.dataSource.query(
            `UPDATE credit_cards SET closing_day = 12, due_day = 20,
                created_at = '2026-01-15T12:00:00Z' WHERE id = $1`,
            [cardId],
        );
    };

    const snapshot = async (): Promise<Snapshot> => {
        const q = <T>(sql: string): Promise<T[]> => ctx.dataSource.query(sql) as Promise<T[]>;

        return {
            expenses: await q(
                "SELECT description, status FROM expenses WHERE description LIKE 'exp-%' ORDER BY description",
            ),
            earnings: await q('SELECT description, status FROM earnings ORDER BY description'),
            statements: await q(
                'SELECT closes_on::text AS closes_on FROM credit_card_statements ORDER BY closes_on',
            ),
            accountBalance: (
                await q('SELECT current_balance_cents FROM bank_accounts ORDER BY id')
            ).map((row) => JSON.stringify(row)),
            cardLimit: await q('SELECT available_limit_cents FROM credit_cards ORDER BY id'),
        };
    };

    const resetScenario = async (): Promise<void> => {
        await ctx.dataSource.query('DELETE FROM credit_card_statements');
        await ctx.dataSource.query('DELETE FROM expenses');
        await ctx.dataSource.query('DELETE FROM earnings');
        await seedScenario();
    };

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);

        for (const registrar of [StatementJobs, ExpenseJobs, EarningJobs]) {
            container.resolve<JobRegistrar>(registrar).register(queue);
        }
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        fixture = await seedFixture(ctx);
        earningTypeId = (
            (await ctx.dataSource.query(
                "INSERT INTO earning_types (name) VALUES ('T-Salário') RETURNING id",
            )) as [{ id: string }]
        )[0].id;
        await seedScenario();
    });

    afterEach(async () => {
        jest.useRealTimers();
        await ctx.dataSource.query('DELETE FROM credit_card_statements');
        await ctx.dataSource.query('DELETE FROM earnings');
        await ctx.dataSource.query("DELETE FROM earning_types WHERE name LIKE 'T-%'");
        await cleanFixture(ctx);
    });

    it('registra as três rotinas e agenda cada uma às 00h15 (15 0 * * *)', () => {
        expect([...handlers.keys()].sort()).toEqual([...JOBS].sort());
        expect([...schedules.entries()].sort()).toEqual(JOBS.map((name) => [name, CRON]).sort());
    });

    it('AC-0017-13: uma execução depois de três dias sem rodar deixa o mesmo estado de rodar todo dia', async () => {
        for (const day of ['2026-03-11', '2026-03-12', '2026-03-13']) {
            await runAt(day);
        }
        const daily = await snapshot();

        await resetScenario();
        await runAt('2026-03-13');
        const recovered = await snapshot();

        expect(recovered).toEqual(daily);
        expect(recovered.expenses).toEqual([
            { description: 'exp-card-10', status: 'OPEN' },
            { description: 'exp-open-10', status: 'OVERDUE' },
            { description: 'exp-open-12', status: 'OVERDUE' },
            { description: 'exp-open-13', status: 'OPEN' },
            { description: 'exp-paid-10', status: 'PAID' },
        ]);
        expect(recovered.earnings).toEqual([
            { description: 'earn-open-10', status: 'OVERDUE' },
            { description: 'earn-open-12', status: 'OVERDUE' },
            { description: 'earn-open-13', status: 'OPEN' },
            { description: 'earn-received-10', status: 'RECEIVED' },
        ]);
        expect(recovered.statements).toEqual([
            { closes_on: '2026-02-12' },
            { closes_on: '2026-03-12' },
        ]);
    }, 30000);

    it('INV-0017-02: rodar duas vezes no mesmo dia chega ao mesmo estado', async () => {
        await runAt('2026-03-13');
        const once = await snapshot();

        await runAt('2026-03-13');

        expect(await snapshot()).toEqual(once);
    }, 30000);

    it('INV-0017-01: as rotinas não mexem em saldo de conta nem em limite de cartão', async () => {
        const before = await snapshot();

        await runAt('2026-03-13');
        const after = await snapshot();

        expect(after.accountBalance).toEqual(before.accountBalance);
        expect(after.cardLimit).toEqual(before.cardLimit);
    }, 30000);

    it('ERR-0017-05: handler que lança propaga o erro e não deixa efeito parcial', async () => {
        const expenses = container.resolve<ExpenseService>(ExpenseServiceSymbol);
        const spy = jest.spyOn(expenses, 'markOverdue').mockRejectedValueOnce(new Error('boom'));
        const before = await snapshot();

        await expect(runAt('2026-03-13', ['expenses.mark-overdue'])).rejects.toThrow('boom');
        expect(await snapshot()).toEqual(before);

        spy.mockRestore();
        // A retentativa conclui o trabalho.
        await runAt('2026-03-13', ['expenses.mark-overdue']);
        expect((await snapshot()).expenses).toContainEqual({
            description: 'exp-open-10',
            status: 'OVERDUE',
        });
    }, 30000);
});
