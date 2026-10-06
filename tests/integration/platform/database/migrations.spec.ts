import type { DataSource } from 'typeorm';

import { createIsolatedDataSource, dropIsolatedDataSource } from '../../database.helper';

const functionExists = async (dataSource: DataSource): Promise<boolean> => {
    // Filtrar por `current_schema()` é o que torna a asserção verdadeira sobre o
    // schema desta suíte, e não sobre qualquer cópia da função no banco.
    const rows = await dataSource.query<{ exists: boolean }[]>(`
        SELECT EXISTS (
            SELECT 1
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE p.proname = 'set_updated_at' AND n.nspname = current_schema()
        ) AS exists;
    `);

    return rows[0]?.exists === true;
};

const appliedMigrations = async (dataSource: DataSource): Promise<string[]> => {
    const rows = await dataSource.query<{ name: string }[]>(
        'SELECT name FROM migrations ORDER BY id;',
    );

    return rows.map((row) => row.name);
};

const SCHEMA = 'test_migrations';

describe('migrations no banco real', () => {
    let dataSource: DataSource;

    // Schema exclusivo desta suíte: ela precisa de um banco vazio, e o Jest roda
    // as suítes em paralelo (ver `createIsolatedDataSource`).
    beforeAll(async () => {
        dataSource = await createIsolatedDataSource(SCHEMA);
    });

    afterAll(async () => {
        await dropIsolatedDataSource(dataSource, SCHEMA);
    });

    it('aplica a baseline num banco vazio (AC-0003-01)', async () => {
        await expect(functionExists(dataSource)).resolves.toBe(false);

        await dataSource.runMigrations();

        await expect(functionExists(dataSource)).resolves.toBe(true);
        expect(await appliedMigrations(dataSource)).toContain('InitialBaseline1758120000000');
    });

    it('é idempotente: a segunda execução não aplica nada (AC-0003-01)', async () => {
        const before = await appliedMigrations(dataSource);

        const applied = await dataSource.runMigrations();

        expect(applied).toHaveLength(0);
        expect(await appliedMigrations(dataSource)).toEqual(before);
    });

    it('desfaz a última migration (AC-0003-02)', async () => {
        // Qual é a última muda a cada spec de domínio; o que a spec 0003 exige é
        // que seja ela a voltar, e só ela.
        const before = await appliedMigrations(dataSource);
        const last = before.at(-1);

        await dataSource.undoLastMigration();

        const after = await appliedMigrations(dataSource);
        expect(after).not.toContain(last);
        expect(after).toEqual(before.slice(0, -1));

        // Deixa o banco aplicado para quem rodar depois.
        await dataSource.runMigrations();
        expect(await appliedMigrations(dataSource)).toEqual(before);
    });

    it('o trigger mantém updated_at na escrita fora do ORM (INV-0003-08)', async () => {
        await dataSource.query(`
            CREATE TABLE trigger_probe (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE TRIGGER set_updated_at BEFORE UPDATE ON trigger_probe
                FOR EACH ROW EXECUTE FUNCTION set_updated_at();
            INSERT INTO trigger_probe DEFAULT VALUES;
        `);

        const [inserted] = await dataSource.query<{ id: string; updated_at: Date }[]>(
            'SELECT id, updated_at FROM trigger_probe;',
        );

        await dataSource.query('UPDATE trigger_probe SET created_at = created_at;');

        const [updated] = await dataSource.query<{ updated_at: Date }[]>(
            'SELECT updated_at FROM trigger_probe;',
        );

        expect(inserted).toBeDefined();
        expect(updated!.updated_at.getTime()).toBeGreaterThan(inserted!.updated_at.getTime());

        await dataSource.query('DROP TABLE trigger_probe;');
    });

    it('a coluna monetária faz round-trip pelo transformer (INV-0003-05)', async () => {
        const { moneyTransformer } =
            await import('../../../../src/platform/database/money.transformer');

        await dataSource.query('CREATE TABLE money_probe (amount numeric(14,2) NOT NULL);');
        await dataSource.query('INSERT INTO money_probe (amount) VALUES ($1);', [
            moneyTransformer.to(1234567),
        ]);

        const [row] = await dataSource.query<{ amount: string }[]>(
            'SELECT amount FROM money_probe;',
        );

        // O driver devolve numeric como string — é disso que o transformer depende.
        expect(typeof row!.amount).toBe('string');
        expect(moneyTransformer.from(row!.amount)).toBe(1234567);

        await dataSource.query('DROP TABLE money_probe;');
    });

    it('cria expense_types e expenses com as constraints nomeadas e os dez tipos (AC-0012-01)', async () => {
        const constraints = await dataSource.query<{ conname: string }[]>(`
            SELECT c.conname
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = current_schema() AND t.relname IN ('expenses', 'expense_types');
        `);

        expect(constraints.map((row) => row.conname)).toEqual(
            expect.arrayContaining([
                'ck_expenses_kind',
                'ck_expenses_status',
                'ck_expenses_amount',
                'ck_expenses_paid_on',
                'ck_expenses_owner',
                'ck_expenses_installment',
                'ck_expenses_posted_on',
                'uq_expenses_installment_group_id_installment_number',
                'fk_expenses_expense_type_id',
                'fk_expenses_bank_account_id',
                'fk_expenses_credit_card_id',
            ]),
        );

        const indexes = await dataSource.query<{ indexname: string }[]>(`
            SELECT indexname FROM pg_indexes
            WHERE schemaname = current_schema() AND tablename IN ('expenses', 'expense_types');
        `);

        expect(indexes.map((row) => row.indexname)).toEqual(
            expect.arrayContaining([
                'uq_expense_types_name',
                'idx_expenses_occurred_on',
                'idx_expenses_bank_account_id',
                'idx_expenses_credit_card_id',
                'idx_expenses_status',
                'idx_expenses_credit_card_id_posted_on',
            ]),
        );

        const types = await dataSource.query<{ name: string }[]>('SELECT name FROM expense_types;');

        expect(types.map((row) => row.name).sort()).toEqual(
            [
                'Moradia',
                'Alimentação',
                'Transporte',
                'Saúde',
                'Educação',
                'Lazer',
                'Vestuário',
                'Assinaturas',
                'Impostos e taxas',
                'Outros',
            ].sort(),
        );
    });

    it('cria as tabelas de receitas, com os oito tipos, e reverte (AC-0014-01)', async () => {
        const { CreateEarningsTables1791306866742 } =
            await import('../../../../src/platform/database/migrations/1791306866742-CreateEarningsTables');

        const constraintsOf = async (table: string): Promise<string[]> => {
            const rows = await dataSource.query<{ conname: string }[]>(
                `SELECT con.conname FROM pg_constraint con
                 JOIN pg_class c ON c.oid = con.conrelid
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relname = $1 AND n.nspname = current_schema()
                 ORDER BY con.conname`,
                [table],
            );
            return rows.map((row) => row.conname);
        };

        expect(await constraintsOf('earning_types')).toEqual(['pk_earning_types']);
        expect(await constraintsOf('earnings')).toEqual([
            'ck_earnings_amount',
            'ck_earnings_installment',
            'ck_earnings_kind',
            'ck_earnings_received_on',
            'ck_earnings_status',
            'fk_earnings_bank_account_id',
            'fk_earnings_earning_type_id',
            'pk_earnings',
            'uq_earnings_installment_group_id_installment_number',
        ]);

        const types = await dataSource.query<{ name: string }[]>(
            'SELECT name FROM earning_types ORDER BY name;',
        );
        expect(types.map((row) => row.name).sort()).toEqual(
            [
                'Salário',
                'Férias, 13º e verbas rescisórias',
                'Rendimento de investimento',
                'Restituição de imposto',
                'Reembolso',
                'Devolução de empréstimo',
                'Rateio de despesa',
                'Outros',
            ].sort(),
        );

        // Reverte e reaplica a própria migration, sem depender de qual é a última.
        const runner = dataSource.createQueryRunner();
        try {
            const migration = new CreateEarningsTables1791306866742();

            await migration.down(runner);
            const gone = await dataSource.query<{ count: string }[]>(
                `SELECT count(*) FROM information_schema.tables
                 WHERE table_schema = current_schema()
                   AND table_name IN ('earnings', 'earning_types')`,
            );
            expect(Number(gone[0]!.count)).toBe(0);

            await migration.up(runner);
            const back = await dataSource.query<{ count: string }[]>(
                'SELECT count(*) FROM earning_types;',
            );
            expect(Number(back[0]!.count)).toBe(8);
        } finally {
            await runner.release();
        }
    });

    it('cria as tabelas de faturas, pagamentos e estornos, e reverte (AC-0013-01)', async () => {
        const { CreateStatementsTables1791400000000 } =
            await import('../../../../src/platform/database/migrations/1791400000000-CreateStatementsTables');

        const constraintsOf = async (table: string): Promise<string[]> => {
            const rows = await dataSource.query<{ conname: string }[]>(
                `SELECT con.conname
                 FROM pg_constraint con
                 JOIN pg_class c ON c.oid = con.conrelid
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relname = $1 AND n.nspname = current_schema()
                 ORDER BY con.conname`,
                [table],
            );
            return rows.map((row) => row.conname);
        };

        expect(await constraintsOf('credit_card_statements')).toEqual([
            'ck_credit_card_statements_dates',
            'ck_credit_card_statements_minimum_payment',
            'ck_credit_card_statements_status',
            'fk_credit_card_statements_credit_card_id',
            'pk_credit_card_statements',
            'uq_credit_card_statements_credit_card_id_closes_on',
            'uq_credit_card_statements_credit_card_id_starts_on',
        ]);
        expect(await constraintsOf('credit_card_statement_payments')).toEqual([
            'ck_credit_card_statement_payments_amount',
            'fk_credit_card_statement_payments_bank_account_id',
            'fk_credit_card_statement_payments_credit_card_id',
            'fk_credit_card_statement_payments_statement_id',
            'pk_credit_card_statement_payments',
        ]);
        expect(await constraintsOf('credit_card_refunds')).toEqual([
            'ck_credit_card_refunds_amount',
            'ck_credit_card_refunds_posted_on',
            'fk_credit_card_refunds_credit_card_id',
            'fk_credit_card_refunds_expense_id',
            'pk_credit_card_refunds',
        ]);

        const tableCount = async (): Promise<number> => {
            const rows = await dataSource.query<{ count: string }[]>(
                `SELECT count(*) FROM information_schema.tables
                 WHERE table_schema = current_schema()
                   AND table_name IN ('credit_card_statements',
                                      'credit_card_statement_payments',
                                      'credit_card_refunds')`,
            );
            return Number(rows[0]!.count);
        };

        const runner = dataSource.createQueryRunner();
        try {
            const migration = new CreateStatementsTables1791400000000();

            await migration.down(runner);
            expect(await tableCount()).toBe(0);

            await migration.up(runner);
            expect(await tableCount()).toBe(3);
        } finally {
            await runner.release();
        }
    });
});
