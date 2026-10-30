import type { DataSource } from 'typeorm';

import { createIsolatedDataSource, dropIsolatedDataSource } from '../database.helper';
import { insertDomainRows, type DomainRows } from '../helpers/domain-rows.helper';

const SCHEMA = 'test_workspace_constraints';

type Reference = {
    table: string;
    column: string;
    /** A linha de A que é copiada, só com a referência trocada. */
    row: keyof DomainRows;
    /** A linha referenciada, que vem de B na cópia. */
    target: keyof DomainRows;
    /**
     * Colunas trocadas na cópia para não esbarrar num índice único antes da FK: o
     * único é verificado na hora, a FK só no fim do comando.
     */
    overrides?: Record<string, string>;
};

/** Toda FK entre tabelas do espaço (spec 0021, Modelo), com a linha que a exercita. */
const REFERENCES: Reference[] = [
    {
        table: 'credit_cards',
        column: 'payment_bank_account_id',
        row: 'cardId',
        target: 'accountId',
        overrides: { name: "'Cópia'" },
    },
    {
        table: 'expenses',
        column: 'bank_account_id',
        row: 'expenseId',
        target: 'accountId',
        overrides: { occurred_on: "'2026-04-05'" },
    },
    { table: 'expenses', column: 'credit_card_id', row: 'cardExpenseId', target: 'cardId' },
    {
        table: 'expenses',
        column: 'recurrence_id',
        row: 'expenseId',
        target: 'expenseRecurrenceId',
        overrides: { occurred_on: "'2026-05-05'" },
    },
    {
        table: 'expense_recurrences',
        column: 'bank_account_id',
        row: 'expenseRecurrenceId',
        target: 'accountId',
    },
    {
        table: 'expense_recurrences',
        column: 'credit_card_id',
        row: 'expenseRecurrenceId',
        target: 'cardId',
        overrides: { bank_account_id: 'NULL' },
    },
    {
        table: 'earnings',
        column: 'bank_account_id',
        row: 'earningId',
        target: 'accountId',
        overrides: { occurred_on: "'2026-04-05'" },
    },
    {
        table: 'earnings',
        column: 'recurrence_id',
        row: 'earningId',
        target: 'earningRecurrenceId',
        overrides: { occurred_on: "'2026-05-05'" },
    },
    {
        table: 'earning_recurrences',
        column: 'bank_account_id',
        row: 'earningRecurrenceId',
        target: 'accountId',
    },
    {
        table: 'credit_card_statements',
        column: 'credit_card_id',
        row: 'statementId',
        target: 'cardId',
        overrides: {
            starts_on: "'2026-03-11'",
            closes_on: "'2026-04-10'",
            due_on: "'2026-04-20'",
        },
    },
    {
        table: 'credit_card_statement_payments',
        column: 'statement_id',
        row: 'paymentId',
        target: 'statementId',
    },
    {
        table: 'credit_card_statement_payments',
        column: 'bank_account_id',
        row: 'paymentId',
        target: 'accountId',
    },
    {
        table: 'credit_card_statement_payments',
        column: 'credit_card_id',
        row: 'paymentId',
        target: 'cardId',
    },
    { table: 'credit_card_refunds', column: 'credit_card_id', row: 'refundId', target: 'cardId' },
    {
        table: 'credit_card_refunds',
        column: 'expense_id',
        row: 'refundId',
        target: 'cardExpenseId',
    },
    {
        table: 'bank_transfers',
        column: 'from_bank_account_id',
        row: 'transferId',
        target: 'accountId',
    },
    {
        table: 'bank_transfers',
        column: 'to_bank_account_id',
        row: 'transferId',
        target: 'otherAccountId',
    },
];

/**
 * O banco garante que uma linha de domínio só referencia linhas do próprio espaço
 * (spec 0021, INV-0021-04), por SQL direto: nenhum serviço no caminho.
 */
describe('constraints por espaço (spec 0021)', () => {
    let dataSource: DataSource;
    let bankId: string;
    let workspaceA: string;
    let workspaceB: string;
    let a: DomainRows;
    let b: DomainRows;

    const createWorkspace = async (name: string): Promise<string> =>
        (
            (await dataSource.query('INSERT INTO workspaces (name) VALUES ($1) RETURNING id', [
                name,
            ])) as [{ id: string }]
        )[0].id;

    /** Colunas que um INSERT copia de uma linha existente. */
    const copiedColumns = async (table: string): Promise<string[]> =>
        (
            (await dataSource.query(
                `SELECT column_name FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = $1
                   AND column_name NOT IN ('id', 'created_at', 'updated_at')
                 ORDER BY ordinal_position`,
                [table],
            )) as { column_name: string }[]
        ).map((row) => row.column_name);

    /** INSERT de uma cópia da linha `rowId` com `column` apontando para `value`. */
    const insertCopy = async (
        reference: Reference,
        rowId: string,
        value: string,
    ): Promise<unknown> => {
        const columns = await copiedColumns(reference.table);
        const select = columns.map((column) =>
            column === reference.column ? '$2' : (reference.overrides?.[column] ?? column),
        );

        return dataSource.query(
            `INSERT INTO ${reference.table} (${columns.join(', ')})
             SELECT ${select.join(', ')} FROM ${reference.table} WHERE id = $1`,
            [rowId, value],
        );
    };

    beforeAll(async () => {
        dataSource = await createIsolatedDataSource(SCHEMA);
        await dataSource.runMigrations();

        // Bancos são catálogo global: os dois espaços usam o mesmo.
        bankId = (
            (await dataSource.query(
                "INSERT INTO banks (febraban_code, name) VALUES ('260', 'Nu') RETURNING id",
            )) as [{ id: string }]
        )[0].id;
        workspaceA = await createWorkspace('Espaço A');
        workspaceB = await createWorkspace('Espaço B');
        a = await insertDomainRows(dataSource, { bankId, workspaceId: workspaceA, tag: 'a' });
        b = await insertDomainRows(dataSource, { bankId, workspaceId: workspaceB, tag: 'b' });
    });

    afterAll(async () => {
        await dropIsolatedDataSource(dataSource, SCHEMA);
    });

    describe('FKs compostas (AC-0021-03, INV-0021-04)', () => {
        it('INSERT de despesa do espaço A com o cartão do espaço B falha pela FK composta', async () => {
            await expect(
                dataSource.query(
                    `INSERT INTO expenses (workspace_id, description, expense_type_id, kind, status,
                        amount_cents, occurred_on, credit_card_id, posted_on)
                     SELECT $1, 'Compra', id, 'VARIABLE', 'OPEN', 10, '2026-03-01', $2, '2026-03-01'
                     FROM expense_types LIMIT 1`,
                    [workspaceA, b.cardId],
                ),
            ).rejects.toMatchObject({ constraint: 'fk_expenses_credit_card_id' });
        });

        it('o mesmo INSERT com o cartão do próprio espaço passa', async () => {
            await expect(
                dataSource.query(
                    `INSERT INTO expenses (workspace_id, description, expense_type_id, kind, status,
                        amount_cents, occurred_on, credit_card_id, posted_on)
                     SELECT $1, 'Compra', id, 'VARIABLE', 'OPEN', 10, '2026-03-01', $2, '2026-03-01'
                     FROM expense_types LIMIT 1`,
                    [workspaceA, a.cardId],
                ),
            ).resolves.toBeDefined();
        });

        it.each(REFERENCES.map((reference) => [reference.table, reference.column, reference]))(
            '%s.%s não aponta para linha de outro espaço',
            async (_table, _column, reference) => {
                await expect(
                    insertCopy(reference, a[reference.row], b[reference.target]),
                ).rejects.toMatchObject({
                    constraint: `fk_${reference.table}_${reference.column}`,
                });
            },
        );

        it.each(REFERENCES.map((reference) => [reference.table, reference.column, reference]))(
            '%s.%s aceita a linha do próprio espaço',
            async (_table, _column, reference) => {
                await expect(
                    insertCopy(reference, a[reference.row], a[reference.target]),
                ).resolves.toBeDefined();
            },
        );

        it('UPDATE que troca a referência por uma de outro espaço também falha', async () => {
            await expect(
                dataSource.query('UPDATE expenses SET credit_card_id = $1 WHERE id = $2', [
                    b.cardId,
                    a.cardExpenseId,
                ]),
            ).rejects.toMatchObject({ constraint: 'fk_expenses_credit_card_id' });
        });

        it('apagar a despesa estornada anula só a referência do estorno, não o espaço', async () => {
            const [refund] = (await dataSource.query(
                `INSERT INTO credit_card_refunds (workspace_id, credit_card_id, expense_id,
                    description, amount_cents, occurred_on, posted_on)
                 VALUES ($1, $2, $3, 'Estorno', 1, '2026-03-02', '2026-03-02') RETURNING id`,
                [workspaceB, b.cardId, b.cardExpenseId],
            )) as [{ id: string }];
            await dataSource.query('DELETE FROM credit_card_refunds WHERE id = $1', [b.refundId]);

            await dataSource.query('DELETE FROM expenses WHERE id = $1', [b.cardExpenseId]);

            await expect(
                dataSource.query(
                    'SELECT workspace_id, expense_id FROM credit_card_refunds WHERE id = $1',
                    [refund.id],
                ),
            ).resolves.toEqual([{ workspace_id: workspaceB, expense_id: null }]);
        });
    });

    describe('únicos por espaço (AC-0021-04)', () => {
        const insertAccount = (workspaceId: string) =>
            dataSource.query(
                `INSERT INTO bank_accounts (workspace_id, bank_id, type, account_number,
                    description, opening_balance_cents, current_balance_cents)
                 VALUES ($1, $2, 'CHECKING', '9999-9', 'Mesma conta', 0, 0)`,
                [workspaceId, bankId],
            );
        const insertCard = (workspaceId: string) =>
            dataSource.query(
                `INSERT INTO credit_cards (workspace_id, bank_id, name, credit_limit_cents,
                    available_limit_cents, closing_day, due_day)
                 VALUES ($1, $2, 'Mesmo cartão', 100, 100, 10, 20)`,
                [workspaceId, bankId],
            );

        it('dois espaços cadastram a mesma conta no mesmo banco e o mesmo cartão, sem conflito', async () => {
            await expect(insertAccount(workspaceA)).resolves.toBeDefined();
            await expect(insertAccount(workspaceB)).resolves.toBeDefined();
            await expect(insertCard(workspaceA)).resolves.toBeDefined();
            await expect(insertCard(workspaceB)).resolves.toBeDefined();
        });

        it('dentro do mesmo espaço, a repetição continua recusada', async () => {
            await expect(insertAccount(workspaceA)).rejects.toMatchObject({
                constraint: 'uq_bank_accounts_bank_id_account_number',
            });
            await expect(insertCard(workspaceA)).rejects.toMatchObject({
                constraint: 'uq_credit_cards_bank_id_name',
            });
        });
    });
});
