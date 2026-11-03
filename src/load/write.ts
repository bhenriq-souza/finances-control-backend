import { businessToday } from '../platform';
import type { LoadServices } from './compose';
import type { LoadPlan, Origin, PlannedExpense } from './plan';
import type { LoadError } from './validate';
import { nameKey } from './values';

/** What happened to each kind of record (spec 0019, _Relatório_). */
export type SectionCounts = { created: number; existing: number; archived?: number };

export type WriteSection =
    | 'bancos'
    | 'contas'
    | 'cartoes'
    | 'tipos_despesa'
    | 'despesas'
    | 'faturas_em_aberto'
    | 'recebimentos';

export type WriteResult = {
    sections: Record<WriteSection, SectionCounts>;
    /** ERR-0019-03 found against the database before any write, or the ERR-0019-07 that stopped it. */
    errors: LoadError[];
};

const emptySections = (): Record<WriteSection, SectionCounts> => ({
    bancos: { created: 0, existing: 0 },
    contas: { created: 0, existing: 0 },
    cartoes: { created: 0, existing: 0 },
    tipos_despesa: { created: 0, existing: 0, archived: 0 },
    despesas: { created: 0, existing: 0 },
    faturas_em_aberto: { created: 0, existing: 0 },
    recebimentos: { created: 0, existing: 0 },
});

/** Raised by `step` to stop the load at the row the service refused (ERR-0019-07). */
class RowRefused extends Error {
    constructor(readonly error: LoadError) {
        super(error.message);
    }
}

const describeFailure = (failure: unknown): string => {
    if (failure instanceof Error) {
        const code = (failure as { code?: unknown }).code;
        return typeof code === 'string' ? `${code}: ${failure.message}` : failure.message;
    }
    return String(failure);
};

/** Natural key of an expense or earning (spec 0019, _Chave natural_). */
const entryKey = (description: string, target: string, occurredOn: string): string =>
    `${nameKey(description)}|${target}|${occurredOn}`;

/**
 * Writes the validated plan through the module services, in the order of spec 0019 (INV-0019-02).
 * Each record is looked up by its natural key first and left untouched when it exists
 * (INV-0019-03). With `dryRun`, the same lookups run and nothing is written (AC-0019-03): the
 * counts are the ones a real run would produce. `today` dates the open statements' entries.
 */
export function writePlan(
    plan: LoadPlan,
    services: LoadServices,
    options: { workspaceId: string; dryRun: boolean; today?: string },
): Promise<WriteResult> {
    return services.inWorkspace(options.workspaceId, () =>
        writeInWorkspace(plan, services, options, options.workspaceId),
    );
}

async function writeInWorkspace(
    plan: LoadPlan,
    services: LoadServices,
    options: { dryRun: boolean; today?: string },
    workspaceId: string,
): Promise<WriteResult> {
    const sections = emptySections();
    const today = options.today ?? businessToday();
    const write = async <T>(
        origin: Pick<Origin, 'file'> & { line?: number },
        action: () => Promise<T>,
    ): Promise<T | undefined> => {
        if (options.dryRun) {
            return undefined;
        }
        try {
            return await action();
        } catch (failure) {
            throw new RowRefused({
                code: 'ERR-0019-07',
                file: origin.file,
                line: origin.line,
                message: describeFailure(failure),
            });
        }
    };
    /** Placeholder id of a record the dry run would create, so references keep resolving. */
    const planned = (key: string): string => `planned:${key}`;

    /* Earning types live only in the database: check them before the first write (INV-0019-01). */
    const earningTypes = new Map(
        (await services.earningTypes.list({ archived: 'true' })).map((type) => [
            nameKey(type.name),
            type,
        ]),
    );
    const missingTypes: LoadError[] = plan.earnings
        .filter((earning) => {
            const type = earningTypes.get(nameKey(earning.earningType));
            return type === undefined || type.archivedAt !== null;
        })
        .map((earning) => ({
            code: 'ERR-0019-03',
            file: earning.file,
            line: earning.line,
            column: 'tipo_receita',
            message: `"${earning.earningType}" não é um tipo de receita ativo no sistema`,
        }));
    if (missingTypes.length > 0) {
        return { sections, errors: missingTypes };
    }

    try {
        /* 1. bancos, by FEBRABAN code */
        const bankIds = new Map<string, string>();
        const banks = await services.banks.list({ archived: 'true' });
        for (const bank of plan.banks) {
            const existing = banks.find((row) => row.febrabanCode === bank.febrabanCode);
            if (existing) {
                sections.bancos.existing += 1;
                bankIds.set(bank.febrabanCode, existing.id);
                continue;
            }
            const created = await write(bank, () =>
                services.banks.create({ febrabanCode: bank.febrabanCode, name: bank.name }),
            );
            sections.bancos.created += 1;
            bankIds.set(bank.febrabanCode, created?.id ?? planned(bank.febrabanCode));
        }

        /* 2. contas, by bank + account number */
        const accountIds = new Map<string, string>();
        const accounts = await services.accounts.list({ archived: 'true' });
        for (const account of plan.accounts) {
            const bankId = bankIds.get(account.febrabanCode)!;
            const existing = accounts.find(
                (row) => row.bankId === bankId && row.accountNumber === account.accountNumber,
            );
            if (existing) {
                sections.contas.existing += 1;
                accountIds.set(nameKey(account.description), existing.id);
                continue;
            }
            const created = await write(account, () =>
                services.accounts.create({
                    bankId,
                    type: account.type,
                    accountNumber: account.accountNumber,
                    description: account.description,
                    openingBalanceCents: account.openingBalanceCents,
                    overdraftLimitCents: account.overdraftLimitCents,
                }),
            );
            sections.contas.created += 1;
            accountIds.set(
                nameKey(account.description),
                created?.id ?? planned(`${account.febrabanCode}|${account.accountNumber}`),
            );
        }

        /* 3. cartoes, by bank + name */
        const cardIds = new Map<string, string>();
        const cards = await services.cards.list(workspaceId, { archived: 'true' });
        for (const card of plan.cards) {
            const bankId = bankIds.get(card.febrabanCode)!;
            const existing = cards.find(
                (row) => row.bankId === bankId && nameKey(row.name) === nameKey(card.name),
            );
            if (existing) {
                sections.cartoes.existing += 1;
                cardIds.set(nameKey(card.name), existing.id);
                continue;
            }
            const created = await write(card, () =>
                services.cards.create({
                    bankId,
                    name: card.name,
                    creditLimitCents: card.creditLimitCents,
                    closingDay: card.closingDay,
                    dueDay: card.dueDay,
                    paymentBankAccountId: accountIds.get(nameKey(card.paymentAccount))!,
                }),
            );
            sections.cartoes.created += 1;
            cardIds.set(
                nameKey(card.name),
                created?.id ?? planned(`${card.febrabanCode}|${card.name}`),
            );
        }

        /* 4. tipos de despesa: create, unarchive, then archive the ones off the sheet */
        const typeIds = new Map<string, string>();
        const types = await services.expenseTypes.list({ archived: 'true' });
        for (const type of plan.expenseTypes) {
            const existing = types.find((row) => nameKey(row.name) === nameKey(type.name));
            if (existing) {
                sections.tipos_despesa.existing += 1;
                typeIds.set(nameKey(type.name), existing.id);
                if (existing.archivedAt !== null) {
                    await write(type, () => services.expenseTypes.setArchived(existing.id, false));
                }
                continue;
            }
            const created = await write(type, () =>
                services.expenseTypes.create({ name: type.name }),
            );
            sections.tipos_despesa.created += 1;
            typeIds.set(nameKey(type.name), created?.id ?? planned(type.name));
        }
        for (const type of types) {
            if (type.archivedAt === null && !typeIds.has(nameKey(type.name))) {
                await write({ file: 'tipos_despesa.csv' }, () =>
                    services.expenseTypes.setArchived(type.id, true),
                );
                sections.tipos_despesa.archived! += 1;
            }
        }

        /* 5–6. despesas fixas e parceladas, by description + account or card + first date */
        const target = (entry: { account?: string; card?: string }) =>
            entry.account !== undefined
                ? { bankAccountId: accountIds.get(nameKey(entry.account))! }
                : { creditCardId: cardIds.get(nameKey(entry.card!))! };
        const targetOf = (row: { bankAccountId: string | null; creditCardId: string | null }) =>
            row.bankAccountId ?? row.creditCardId ?? '';
        const expenseKeys = new Set(
            (await services.expenses.list()).map((row) =>
                entryKey(row.description, targetOf(row), row.occurredOn),
            ),
        );
        const statementKeys = new Set(
            [...expenseKeys].map((key) => key.slice(0, key.lastIndexOf('|'))),
        );
        const createExpense = (expense: PlannedExpense) => {
            const where = target(expense);
            return services.expenses.create({
                description: expense.description,
                expenseTypeId: typeIds.get(nameKey(expense.expenseType))!,
                kind: expense.kind,
                amountCents: expense.amountCents,
                occurredOn: expense.occurredOn,
                ...where,
                status: expense.status,
                ...(expense.installmentTotal !== undefined && {
                    installmentTotal: expense.installmentTotal,
                }),
                ...(expense.recurrenceEndsOn !== undefined && {
                    recurrenceEndsOn: expense.recurrenceEndsOn,
                }),
                ...(expense.notes !== undefined && { notes: expense.notes }),
            });
        };
        for (const expense of plan.expenses) {
            const where = target(expense);
            const key = entryKey(
                expense.description,
                where.bankAccountId ?? where.creditCardId!,
                expense.occurredOn,
            );
            if (expenseKeys.has(key)) {
                sections.despesas.existing += 1;
                continue;
            }
            await write(expense, () => createExpense(expense));
            sections.despesas.created += 1;
        }

        /* 7. faturas em aberto: a card entry dated today, keyed without the date */
        for (const statement of plan.openStatements) {
            const cardId = cardIds.get(nameKey(statement.card))!;
            if (statementKeys.has(`${nameKey(statement.description)}|${cardId}`)) {
                sections.faturas_em_aberto.existing += 1;
                continue;
            }
            await write(statement, () =>
                services.expenses.create({
                    description: statement.description,
                    expenseTypeId: typeIds.get(nameKey(statement.expenseType))!,
                    kind: 'VARIABLE',
                    amountCents: statement.amountCents,
                    occurredOn: today,
                    creditCardId: cardId,
                    status: 'OPEN',
                }),
            );
            sections.faturas_em_aberto.created += 1;
        }

        /* 8. recebimentos, by description + account + first date */
        const earningKeys = new Set(
            (await services.earnings.list()).map((row) =>
                entryKey(row.description, row.bankAccountId, row.occurredOn),
            ),
        );
        for (const earning of plan.earnings) {
            const bankAccountId = accountIds.get(nameKey(earning.account))!;
            if (earningKeys.has(entryKey(earning.description, bankAccountId, earning.occurredOn))) {
                sections.recebimentos.existing += 1;
                continue;
            }
            await write(earning, () =>
                services.earnings.create({
                    description: earning.description,
                    earningTypeId: earningTypes.get(nameKey(earning.earningType))!.id,
                    kind: earning.kind,
                    amountCents: earning.amountCents,
                    occurredOn: earning.occurredOn,
                    bankAccountId,
                    status: earning.status,
                    ...(earning.installmentTotal !== undefined && {
                        installmentTotal: earning.installmentTotal,
                    }),
                    ...(earning.recurrenceEndsOn !== undefined && {
                        recurrenceEndsOn: earning.recurrenceEndsOn,
                    }),
                    ...(earning.notes !== undefined && { notes: earning.notes }),
                }),
            );
            sections.recebimentos.created += 1;
        }
    } catch (failure) {
        if (failure instanceof RowRefused) {
            return { sections, errors: [failure.error] };
        }
        throw failure;
    }

    return { sections, errors: [] };
}
