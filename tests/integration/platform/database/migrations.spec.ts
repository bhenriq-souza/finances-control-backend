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
});
