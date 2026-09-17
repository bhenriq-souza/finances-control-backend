import { SnakeCaseNamingStrategy } from '../../../src/platform/database/snake-case.naming-strategy';

describe('SnakeCaseNamingStrategy', () => {
    const strategy = new SnakeCaseNamingStrategy();

    describe('tabelas e colunas', () => {
        it('converte o nome da classe em snake_case quando nada foi declarado', () => {
            expect(strategy.tableName('BankAccount', undefined)).toBe('bank_account');
        });

        it('respeita o nome declarado no @Entity — é ele que dá o plural', () => {
            expect(strategy.tableName('BankAccount', 'bank_accounts')).toBe('bank_accounts');
        });

        it('converte a propriedade em snake_case', () => {
            expect(strategy.columnName('creditLimitCents', undefined, [])).toBe(
                'credit_limit_cents',
            );
        });

        it('preserva siglas coladas', () => {
            expect(strategy.columnName('firebaseUID', undefined, [])).toBe('firebase_uid');
            expect(strategy.tableName('CSVImport', undefined)).toBe('csv_import');
        });

        it('respeita o nome de coluna declarado', () => {
            expect(strategy.columnName('amount', 'amount_cents', [])).toBe('amount_cents');
        });

        it('prefixa colunas de embedded', () => {
            expect(strategy.columnName('city', undefined, ['billingAddress'])).toBe(
                'billing_address_city',
            );
        });

        it('nomeia a coluna de junção pela relação e pela coluna referenciada', () => {
            expect(strategy.joinColumnName('bankAccount', 'id')).toBe('bank_account_id');
        });

        it('converte o nome da relação', () => {
            expect(strategy.relationName('creditCard')).toBe('credit_card');
        });

        it('nomeia a tabela de junção pelas duas pontas', () => {
            expect(strategy.joinTableName('expenses', 'tags', 'appliedTags', 'expenses')).toBe(
                'expenses_applied_tags_tags',
            );
        });

        it('nomeia a coluna da tabela de junção, com e sem nome declarado', () => {
            expect(strategy.joinTableColumnName('expenses', 'id')).toBe('expenses_id');
            expect(strategy.joinTableColumnName('expenses', 'id', 'expenseId')).toBe(
                'expenses_expense_id',
            );
        });
    });

    describe('objetos de schema', () => {
        it('prefixa a chave primária com pk_', () => {
            expect(strategy.primaryKeyName('expenses', ['id'])).toBe('pk_expenses');
        });

        it('prefixa a chave estrangeira com fk_ e lista as colunas', () => {
            expect(strategy.foreignKeyName('expenses', ['bank_account_id'])).toBe(
                'fk_expenses_bank_account_id',
            );
        });

        it('prefixa a constraint única com uq_', () => {
            expect(strategy.uniqueConstraintName('users', ['email'])).toBe('uq_users_email');
        });

        it('prefixa o índice com idx_', () => {
            expect(strategy.indexName('expenses', ['due_date', 'status'])).toBe(
                'idx_expenses_due_date_status',
            );
        });

        it('nomeia o check com ck_ e um hash estável da expressão', () => {
            const first = strategy.checkConstraintName('expenses', 'amount_cents > 0');
            const second = strategy.checkConstraintName('expenses', 'amount_cents > 0');

            expect(first).toMatch(/^ck_expenses_[0-9a-f]{8}$/);
            expect(second).toBe(first);
        });

        it('trunca no limite de identificador do PostgreSQL', () => {
            const name = strategy.indexName('a'.repeat(60), ['b'.repeat(60)]);

            expect(name.length).toBe(63);
            expect(name.startsWith('idx_')).toBe(true);
        });
    });
});
