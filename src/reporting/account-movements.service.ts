import { inject, injectable } from 'tsyringe';
import type { DataSource } from 'typeorm';

import {
    DatabaseConnectionSymbol,
    RequestContextSymbol,
    moneyTransformer,
    type RequestContext,
} from '../platform';
import { previousDay } from './account-movements.schemas';
import { EARNING_REALIZED, EXPENSE_REALIZED } from './composition';
import { RealizedBalanceService } from './realized-balance.service';
import { RealizedBalanceServiceSymbol } from './reporting.symbols';

export type MovementKind =
    'EARNING' | 'EXPENSE' | 'STATEMENT_PAYMENT' | 'TRANSFER_IN' | 'TRANSFER_OUT';

export type AccountMovement = {
    date: string;
    kind: MovementKind;
    sourceId: string;
    description: string | null;
    typeName: string | null;
    creditCardId: string | null;
    statementId: string | null;
    counterpartBankAccountId: string | null;
    amountCents: number;
    balanceAfterCents: number;
};

export type AccountMovementsReport = {
    bankAccountId: string;
    from: string;
    to: string;
    openingBalanceCents: number;
    closingBalanceCents: number;
    movements: AccountMovement[];
};

type Params = { bankAccountId: string; from: string; to: string };

type Row = {
    date: string;
    kind: MovementKind;
    source_id: string;
    description: string | null;
    type_name: string | null;
    credit_card_id: string | null;
    statement_id: string | null;
    counterpart_id: string | null;
    amount: string;
};

/**
 * Extrato de uma conta (spec 0015, AC-0015-14 a AC-0015-16, INV-0015-08): os quatro caminhos
 * do saldo realizado, um movimento por lançamento, com o saldo depois de cada um. Abertura e
 * fechamento saem do `RealizedBalanceService`, a única fórmula do saldo realizado; os status
 * vêm da regra de composição (INV-0015-02). Somente leitura, por SQL próprio (INV-0015-01);
 * somas em `numeric`, convertidas em inteiro de centavos (INV-0015-04).
 */
@injectable()
export class AccountMovementsReportService {
    constructor(
        @inject(DatabaseConnectionSymbol) private readonly dataSource: DataSource,
        @inject(RealizedBalanceServiceSymbol) private readonly realized: RealizedBalanceService,
        @inject(RequestContextSymbol) private readonly requestContext: RequestContext,
    ) {}

    async movements({ bankAccountId, from, to }: Params): Promise<AccountMovementsReport> {
        const workspaceId = this.requestContext.requireWorkspaceId();
        // Também garante que a conta existe no espaço (404 BANK_ACCOUNT_NOT_FOUND).
        const openingBalanceCents = await this.realized.balanceOn(
            workspaceId,
            bankAccountId,
            previousDay(from),
        );

        const rows = (await this.dataSource.query(
            `SELECT to_char(m.day, 'YYYY-MM-DD') AS date, m.kind, m.source_id, m.description,
                    m.type_name, m.credit_card_id, m.statement_id, m.counterpart_id,
                    m.amount::text AS amount
             FROM (
                SELECT e.received_on AS day, 'EARNING' AS kind, e.id AS source_id,
                       e.description, t.name AS type_name, NULL::uuid AS credit_card_id,
                       NULL::uuid AS statement_id, NULL::uuid AS counterpart_id,
                       e.amount_cents AS amount, e.created_at
                FROM earnings e JOIN earning_types t ON t.id = e.earning_type_id
                WHERE e.workspace_id = $6 AND e.bank_account_id = $1
                  AND e.status = ANY($4::text[])
              UNION ALL
                SELECT x.paid_on, 'EXPENSE', x.id, x.description, t.name, NULL, NULL, NULL,
                       -x.amount_cents, x.created_at
                FROM expenses x JOIN expense_types t ON t.id = x.expense_type_id
                WHERE x.workspace_id = $6 AND x.bank_account_id = $1
                  AND x.status = ANY($5::text[])
              UNION ALL
                SELECT p.paid_on, 'STATEMENT_PAYMENT', p.id, NULL, NULL, p.credit_card_id,
                       p.statement_id, NULL, -p.amount_cents, p.created_at
                FROM credit_card_statement_payments p
                WHERE p.workspace_id = $6 AND p.bank_account_id = $1
              UNION ALL
                SELECT t.completed_on, 'TRANSFER_IN', t.id, t.description, NULL, NULL, NULL,
                       t.from_bank_account_id, t.amount_cents, t.created_at
                FROM bank_transfers t
                WHERE t.workspace_id = $6 AND t.to_bank_account_id = $1 AND t.status = 'COMPLETED'
              UNION ALL
                SELECT t.completed_on, 'TRANSFER_OUT', t.id, t.description, NULL, NULL, NULL,
                       t.to_bank_account_id, -t.amount_cents, t.created_at
                FROM bank_transfers t
                WHERE t.workspace_id = $6 AND t.from_bank_account_id = $1 AND t.status = 'COMPLETED'
             ) m
             WHERE m.day >= $2::date AND m.day <= $3::date
             ORDER BY m.day, m.created_at, m.source_id`,
            [bankAccountId, from, to, [...EARNING_REALIZED], [...EXPENSE_REALIZED], workspaceId],
        )) as Row[];

        let balance = openingBalanceCents;
        const movements = rows.map((row): AccountMovement => {
            const amountCents = moneyTransformer.from(row.amount) as number;

            balance += amountCents;

            return {
                date: row.date,
                kind: row.kind,
                sourceId: row.source_id,
                description: row.description,
                typeName: row.type_name,
                creditCardId: row.credit_card_id,
                statementId: row.statement_id,
                counterpartBankAccountId: row.counterpart_id,
                amountCents,
                balanceAfterCents: balance,
            };
        });

        return {
            bankAccountId,
            from,
            to,
            openingBalanceCents,
            closingBalanceCents: await this.realized.balanceOn(workspaceId, bankAccountId, to),
            movements,
        };
    }
}
