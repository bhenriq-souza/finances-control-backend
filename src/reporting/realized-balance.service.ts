import { CustomError } from '@bhs-dev/typescript-common-errors';
import { inject, injectable } from 'tsyringe';
import type { DataSource } from 'typeorm';

import { DatabaseConnectionSymbol, moneyTransformer } from '../platform';
import { EARNING_REALIZED, EXPENSE_REALIZED } from './composition';

/**
 * Saldo realizado de uma conta em qualquer data (spec 0015, AC-0015-01, INV-0015-03):
 * saldo de abertura mais o que de fato se moveu até `D`, por quatro caminhos —
 * receita recebida, despesa de conta paga, pagamento de fatura e transferência concluída
 * (`+` as que entram na conta, `−` as que saem, pela data de conclusão; spec 0018).
 *
 * Somente leitura, por SQL próprio (INV-0015-01). Toda soma é feita em `numeric`
 * no banco e convertida em inteiro de centavos por dígitos (INV-0015-04).
 */
@injectable()
export class RealizedBalanceService {
    constructor(@inject(DatabaseConnectionSymbol) private readonly dataSource: DataSource) {}

    /** `date` é um dia civil `YYYY-MM-DD`; o saldo inclui os movimentos desse dia. */
    async balanceOn(bankAccountId: string, date: string): Promise<number> {
        const rows = (await this.dataSource.query(
            `SELECT (
                a.opening_balance_cents
                + COALESCE((SELECT SUM(e.amount_cents) FROM earnings e
                            WHERE e.bank_account_id = a.id
                              AND e.status = ANY($3::text[]) AND e.received_on <= $2::date), 0)
                - COALESCE((SELECT SUM(x.amount_cents) FROM expenses x
                            WHERE x.bank_account_id = a.id
                              AND x.status = ANY($4::text[]) AND x.paid_on <= $2::date), 0)
                - COALESCE((SELECT SUM(p.amount_cents) FROM credit_card_statement_payments p
                            WHERE p.bank_account_id = a.id AND p.paid_on <= $2::date), 0)
                + COALESCE((SELECT SUM(t.amount_cents) FROM bank_transfers t
                            WHERE t.to_bank_account_id = a.id
                              AND t.status = 'COMPLETED' AND t.completed_on <= $2::date), 0)
                - COALESCE((SELECT SUM(t.amount_cents) FROM bank_transfers t
                            WHERE t.from_bank_account_id = a.id
                              AND t.status = 'COMPLETED' AND t.completed_on <= $2::date), 0)
            )::text AS balance
            FROM bank_accounts a
            WHERE a.id = $1`,
            [bankAccountId, date, [...EARNING_REALIZED], [...EXPENSE_REALIZED]],
        )) as Array<{ balance: string }>;

        const row = rows[0];

        if (!row) {
            throw CustomError.notFound('Bank account not found', 'BANK_ACCOUNT_NOT_FOUND', {
                exposeMessage: true,
            });
        }

        return moneyTransformer.from(row.balance) as number;
    }
}
