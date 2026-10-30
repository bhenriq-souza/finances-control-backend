import type { DataSource } from 'typeorm';

/** As tabelas de domínio da spec 0021, todas com `workspace_id`. */
export const DOMAIN_TABLES = [
    'bank_accounts',
    'credit_cards',
    'expense_recurrences',
    'expenses',
    'earning_recurrences',
    'earnings',
    'credit_card_statements',
    'credit_card_statement_payments',
    'credit_card_refunds',
    'bank_transfers',
] as const;

/** Uma linha de cada tabela de domínio, com as referências entre elas preenchidas. */
export type DomainRows = {
    accountId: string;
    otherAccountId: string;
    cardId: string;
    expenseRecurrenceId: string;
    /** Despesa `FIXED` da série, em conta. */
    expenseId: string;
    /** Despesa `VARIABLE` no cartão. */
    cardExpenseId: string;
    earningRecurrenceId: string;
    earningId: string;
    statementId: string;
    paymentId: string;
    refundId: string;
    transferId: string;
};

/**
 * Insere, por SQL direto, uma linha em cada tabela de domínio (spec 0021, Modelo).
 * Com `workspaceId` nulo, escreve no esquema anterior à migration dos espaços,
 * sem a coluna; senão grava todas as linhas naquele espaço. `tag` diferencia os
 * nomes e números quando dois conjuntos dividem o banco.
 */
export async function insertDomainRows(
    dataSource: DataSource,
    options: { bankId: string; workspaceId: string | null; tag: string },
): Promise<DomainRows> {
    const { bankId, workspaceId, tag } = options;
    const insert = async (
        table: string,
        values: Record<string, string | number | null>,
    ): Promise<string> => {
        const row = workspaceId === null ? values : { workspace_id: workspaceId, ...values };
        const columns = Object.keys(row);
        const [inserted] = (await dataSource.query(
            `INSERT INTO ${table} (${columns.join(', ')})
             VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})
             RETURNING id`,
            Object.values(row),
        )) as [{ id: string }];

        return inserted.id;
    };
    const [expenseType] = (await dataSource.query(
        'SELECT id FROM expense_types ORDER BY name LIMIT 1',
    )) as [{ id: string }];
    const [earningType] = (await dataSource.query(
        'SELECT id FROM earning_types ORDER BY name LIMIT 1',
    )) as [{ id: string }];

    const account = (number: string) =>
        insert('bank_accounts', {
            bank_id: bankId,
            type: 'CHECKING',
            account_number: `${tag}-${number}`,
            description: `Conta ${tag} ${number}`,
            opening_balance_cents: 100,
            current_balance_cents: 100,
        });
    const accountId = await account('1');
    const otherAccountId = await account('2');
    const cardId = await insert('credit_cards', {
        bank_id: bankId,
        name: `Cartão ${tag}`,
        credit_limit_cents: 1000,
        available_limit_cents: 1000,
        closing_day: 10,
        due_day: 20,
        payment_bank_account_id: accountId,
    });
    const expenseRecurrenceId = await insert('expense_recurrences', {
        description: 'Aluguel',
        expense_type_id: expenseType.id,
        amount_cents: 50,
        day_of_month: 5,
        bank_account_id: accountId,
        starts_on: '2026-03-05',
    });
    const expenseId = await insert('expenses', {
        description: 'Aluguel',
        expense_type_id: expenseType.id,
        kind: 'FIXED',
        status: 'OPEN',
        amount_cents: 50,
        occurred_on: '2026-03-05',
        bank_account_id: accountId,
        recurrence_id: expenseRecurrenceId,
    });
    const cardExpenseId = await insert('expenses', {
        description: 'Compra',
        expense_type_id: expenseType.id,
        kind: 'VARIABLE',
        status: 'OPEN',
        amount_cents: 30,
        occurred_on: '2026-03-01',
        credit_card_id: cardId,
        posted_on: '2026-03-01',
    });
    const earningRecurrenceId = await insert('earning_recurrences', {
        description: 'Salário',
        earning_type_id: earningType.id,
        amount_cents: 200,
        day_of_month: 5,
        bank_account_id: accountId,
        starts_on: '2026-03-05',
    });
    const earningId = await insert('earnings', {
        description: 'Salário',
        earning_type_id: earningType.id,
        kind: 'FIXED',
        status: 'OPEN',
        amount_cents: 200,
        occurred_on: '2026-03-05',
        bank_account_id: accountId,
        recurrence_id: earningRecurrenceId,
    });
    const statementId = await insert('credit_card_statements', {
        credit_card_id: cardId,
        starts_on: '2026-02-11',
        closes_on: '2026-03-10',
        due_on: '2026-03-20',
        status: 'CLOSED',
        previous_balance_cents: 0,
        closed_at: '2026-03-11T03:00:00Z',
    });
    const paymentId = await insert('credit_card_statement_payments', {
        credit_card_id: cardId,
        statement_id: statementId,
        bank_account_id: accountId,
        amount_cents: 10,
        paid_on: '2026-03-15',
    });
    const refundId = await insert('credit_card_refunds', {
        credit_card_id: cardId,
        expense_id: cardExpenseId,
        description: 'Estorno',
        amount_cents: 5,
        occurred_on: '2026-03-02',
        posted_on: '2026-03-02',
    });
    const transferId = await insert('bank_transfers', {
        from_bank_account_id: accountId,
        to_bank_account_id: otherAccountId,
        amount_cents: 10,
        occurred_on: '2026-03-12',
        status: 'SCHEDULED',
        description: 'Reserva',
    });

    return {
        accountId,
        otherAccountId,
        cardId,
        expenseRecurrenceId,
        expenseId,
        cardExpenseId,
        earningRecurrenceId,
        earningId,
        statementId,
        paymentId,
        refundId,
        transferId,
    };
}
