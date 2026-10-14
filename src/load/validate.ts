import type { BankAccountType } from '../accounts';
import { parseCsv } from './csv';
import type {
    CreationStatus,
    LoadPlan,
    PlannedEarning,
    PlannedExpense,
    PlannedOpenStatement,
    Target,
} from './plan';
import { nameKey, parseInteger, parseIsoDate, parseMoneyCents, parseYesNo } from './values';

/** The tab files, in the order they are validated and written (spec 0019, _Ordem de gravação_). */
export const LOAD_FILES = [
    'bancos.csv',
    'contas.csv',
    'cartoes.csv',
    'tipos_despesa.csv',
    'despesas_fixas.csv',
    'despesas_parceladas.csv',
    'faturas_em_aberto.csv',
    'recebimentos.csv',
] as const;

export type LoadFile = (typeof LOAD_FILES)[number];

/** The columns each file must have (spec 0019, _Abas e mapeamento_). */
export const LOAD_COLUMNS: Record<LoadFile, readonly string[]> = {
    'bancos.csv': ['nome', 'codigo_febraban', 'importar'],
    'contas.csv': [
        'banco',
        'descricao',
        'tipo',
        'numero_conta',
        'saldo_inicial',
        'data_saldo',
        'limite_cheque_especial',
        'importar',
    ],
    'cartoes.csv': [
        'banco',
        'nome',
        'limite',
        'dia_fechamento',
        'dia_vencimento',
        'conta_pagadora',
        'importar',
    ],
    'tipos_despesa.csv': ['nome', 'importar'],
    'despesas_fixas.csv': [
        'descricao',
        'tipo_despesa',
        'valor',
        'conta',
        'cartao',
        'proxima_data',
        'data_fim',
        'situacao',
        'importar',
        'observacao',
    ],
    'despesas_parceladas.csv': [
        'descricao',
        'tipo_despesa',
        'valor_parcela',
        'conta',
        'cartao',
        'data_proxima_parcela',
        'parcela_proxima',
        'parcelas_total',
        'parcelas_restantes',
        'importar',
        'observacao',
    ],
    'faturas_em_aberto.csv': [
        'cartao',
        'vencimento',
        'valor',
        'tipo_despesa',
        'importar',
        'observacao',
    ],
    'recebimentos.csv': [
        'descricao',
        'tipo_receita',
        'ocorrencia',
        'valor',
        'conta',
        'proxima_data',
        'data_fim',
        'parcela_proxima',
        'parcelas_total',
        'parcelas_restantes',
        'situacao',
        'pagante',
        'importar',
        'observacao',
    ],
};

export type LoadErrorCode =
    | 'ERR-0019-01'
    | 'ERR-0019-02'
    | 'ERR-0019-03'
    | 'ERR-0019-04'
    | 'ERR-0019-05'
    | 'ERR-0019-06'
    | 'ERR-0019-07';

export type LoadError = {
    code: LoadErrorCode;
    file: string;
    line?: number;
    column?: string;
    message: string;
};

export type LoadWarning = { file: string; line: number; message: string };

export type TabSummary = { file: LoadFile; toImport: number; ignored: number };

export type Validation = {
    plan: LoadPlan;
    errors: LoadError[];
    warnings: LoadWarning[];
    tabs: TabSummary[];
};

/** Raw file contents by file name; a missing entry is a missing file. */
export type LoadFiles = Partial<Record<LoadFile, string>>;

const CREATION_STATUSES = ['OPEN', 'FORECAST'] as const;

/**
 * The account types of spec 0011. A type-only import keeps validation free of the module's
 * runtime, which opens the database; `satisfies` fails the build if the two lists drift.
 */
const ACCOUNT_TYPES = [
    'CHECKING',
    'SAVINGS',
    'INVESTMENT',
] as const satisfies readonly BankAccountType[];
const KINDS = ['FIXED', 'VARIABLE', 'INSTALLMENT'] as const;

/** Limits of the creation contracts of specs 0011, 0012 and 0014 (ERR-0019-06). */
const MAX = { name: 120, accountNumber: 40, description: 200, notes: 1000, installments: 120 };

type Row = { file: LoadFile; line: number; get: (column: string) => string };

/** Accumulates errors; every parser reports and returns `undefined` on failure. */
class Checker {
    readonly errors: LoadError[] = [];
    readonly warnings: LoadWarning[] = [];

    error(code: LoadErrorCode, row: Row, column: string | undefined, message: string): undefined {
        this.errors.push({ code, file: row.file, line: row.line, column, message });
        return undefined;
    }

    warn(row: Row, message: string): void {
        this.warnings.push({ file: row.file, line: row.line, message });
    }

    required(row: Row, column: string, max?: number): string | undefined {
        const value = row.get(column);
        if (value === '') {
            return this.error('ERR-0019-06', row, column, 'obrigatório');
        }
        if (max !== undefined && value.length > max) {
            return this.error('ERR-0019-06', row, column, `passa de ${max} caracteres`);
        }
        return value;
    }

    money(row: Row, column: string, options: { optional?: boolean; positive?: boolean } = {}) {
        const raw = row.get(column);
        if (raw === '') {
            return options.optional ? 0 : this.error('ERR-0019-06', row, column, 'obrigatório');
        }
        const cents = parseMoneyCents(raw);
        if (cents === undefined) {
            return this.error('ERR-0019-02', row, column, `"${raw}" não é um valor válido`);
        }
        if (options.positive && cents === 0) {
            return this.error('ERR-0019-06', row, column, 'precisa ser maior que zero');
        }
        return cents;
    }

    date(row: Row, column: string, optional = false): string | undefined {
        const raw = row.get(column);
        if (raw === '') {
            return optional ? undefined : this.error('ERR-0019-06', row, column, 'obrigatório');
        }
        return (
            parseIsoDate(raw) ??
            this.error('ERR-0019-02', row, column, `"${raw}" não é uma data AAAA-MM-DD válida`)
        );
    }

    integer(row: Row, column: string, min: number, max: number): number | undefined {
        const raw = row.get(column);
        if (raw === '') {
            return this.error('ERR-0019-06', row, column, 'obrigatório');
        }
        const value = parseInteger(raw);
        if (value === undefined) {
            return this.error('ERR-0019-02', row, column, `"${raw}" não é um número inteiro`);
        }
        if (value < min || value > max) {
            return this.error('ERR-0019-06', row, column, `precisa estar entre ${min} e ${max}`);
        }
        return value;
    }

    oneOf<T extends string>(row: Row, column: string, values: readonly T[]): T | undefined {
        const raw = row.get(column);
        if (raw === '') {
            return this.error('ERR-0019-06', row, column, 'obrigatório');
        }
        const value = raw.toUpperCase() as T;
        return values.includes(value)
            ? value
            : this.error('ERR-0019-02', row, column, `"${raw}" não é um de ${values.join(', ')}`);
    }

    /** Resolves a name against the rows marked `sim` of another tab (ERR-0019-03). */
    reference<T>(row: Row, column: string, target: Map<string, T>, targetFile: string) {
        const raw = row.get(column);
        if (raw === '') {
            return this.error('ERR-0019-06', row, column, 'obrigatório');
        }
        return (
            target.get(nameKey(raw)) ??
            this.error('ERR-0019-03', row, column, `"${raw}" não está em ${targetFile}`)
        );
    }

    /** Records a natural key and reports a repetition within the tab (ERR-0019-05). */
    unique(row: Row, column: string, seen: Map<string, number>, key: string): boolean {
        const first = seen.get(key);
        if (first !== undefined) {
            this.error('ERR-0019-05', row, column, `repetido na linha ${first}`);
            return false;
        }
        seen.set(key, row.line);
        return true;
    }
}

type Tab = { rows: Row[]; ignored: number };

/** Header check (ERR-0019-01), then the rows to import; `importar = não` rows are only counted. */
function readTab(file: LoadFile, text: string | undefined, check: Checker): Tab | undefined {
    if (text === undefined) {
        check.errors.push({ code: 'ERR-0019-01', file, message: 'arquivo ausente' });
        return undefined;
    }

    const [header, ...records] = parseCsv(text);
    const names = (header?.fields ?? []).map((name) => name.trim());
    const missing = LOAD_COLUMNS[file].filter((column) => !names.includes(column));
    for (const column of missing) {
        check.errors.push({
            code: 'ERR-0019-01',
            file,
            column,
            message: `coluna ${column} ausente`,
        });
    }
    if (missing.length > 0) {
        return undefined;
    }

    const tab: Tab = { rows: [], ignored: 0 };
    for (const record of records) {
        const row: Row = {
            file,
            line: record.line,
            get: (column) => (record.fields[names.indexOf(column)] ?? '').trim(),
        };
        const raw = row.get('importar');
        const importar = parseYesNo(raw);
        if (importar === undefined) {
            check.error('ERR-0019-02', row, 'importar', `"${raw}" não é sim nem não`);
        } else if (importar) {
            tab.rows.push(row);
        } else {
            tab.ignored += 1;
        }
    }
    return tab;
}

/** `conta` or `cartao`, never both and never neither (ERR-0019-04). */
function target(
    row: Row,
    check: Checker,
    accounts: Map<string, string>,
    cards: Map<string, string>,
): Target | undefined {
    const account = row.get('conta');
    const card = row.get('cartao');
    if ((account === '') === (card === '')) {
        return check.error('ERR-0019-04', row, undefined, 'preencha conta ou cartao, não os dois');
    }
    if (account !== '') {
        const resolved = check.reference(row, 'conta', accounts, 'contas');
        return resolved === undefined ? undefined : { account: resolved };
    }
    const resolved = check.reference(row, 'cartao', cards, 'cartoes');
    return resolved === undefined ? undefined : { card: resolved };
}

/** The original numbering, kept because a group restarts at 1 in the system (spec 0019). */
const numbered = (description: string, next: number, total: number, remaining: number): string =>
    remaining === 1
        ? `${description} (${total}/${total})`
        : `${description} (${next}–${total}/${total})`;

const targetKey = (value: Target): string =>
    value.account !== undefined
        ? `conta:${nameKey(value.account)}`
        : `cartao:${nameKey(value.card!)}`;

function checkInstallmentNumbering(
    row: Row,
    check: Checker,
    next: number,
    total: number,
    remaining: number,
): void {
    if (next + remaining - 1 !== total) {
        check.warn(
            row,
            `parcela_proxima (${next}) + parcelas_restantes (${remaining}) − 1 difere de parcelas_total (${total})`,
        );
    }
}

function checkDescription(row: Row, check: Checker, description: string): string | undefined {
    return description.length > MAX.description
        ? check.error('ERR-0019-06', row, 'descricao', `passa de ${MAX.description} caracteres`)
        : description;
}

function checkNotes(row: Row, check: Checker, notes: string | undefined): string | undefined {
    return notes !== undefined && notes.length > MAX.notes
        ? check.error('ERR-0019-06', row, 'observacao', `passa de ${MAX.notes} caracteres`)
        : notes;
}

/**
 * Reads and checks every tab and every reference before anything is written (INV-0019-01). The
 * plan is complete only when `errors` is empty; earning types, which live only in the database,
 * are checked by the writer before its first write.
 */
export function validateLoad(files: LoadFiles): Validation {
    const check = new Checker();
    const plan: LoadPlan = {
        banks: [],
        accounts: [],
        cards: [],
        expenseTypes: [],
        expenses: [],
        openStatements: [],
        earnings: [],
    };

    const tabs = new Map<LoadFile, Tab>();
    for (const file of LOAD_FILES) {
        const tab = readTab(file, files[file], check);
        if (tab) {
            tabs.set(file, tab);
        }
    }
    const summaries = (): TabSummary[] =>
        LOAD_FILES.filter((file) => tabs.has(file)).map((file) => ({
            file,
            toImport: tabs.get(file)!.rows.length,
            ignored: tabs.get(file)!.ignored,
        }));

    // A missing file or column makes every later reference noise: report only the structure.
    if (tabs.size < LOAD_FILES.length) {
        return { plan, errors: check.errors, warnings: [], tabs: summaries() };
    }
    const rows = (file: LoadFile): Row[] => tabs.get(file)!.rows;

    /* bancos: by name → FEBRABAN code */
    const banks = new Map<string, string>();
    const bankCodes = new Map<string, number>();
    const bankNames = new Map<string, number>();
    for (const row of rows('bancos.csv')) {
        const name = check.required(row, 'nome', MAX.name);
        const rawCode = check.required(row, 'codigo_febraban');
        const code =
            rawCode === undefined || /^\d{3}$/.test(rawCode)
                ? rawCode
                : check.error(
                      'ERR-0019-02',
                      row,
                      'codigo_febraban',
                      `"${rawCode}" não tem três dígitos`,
                  );
        // A row marked `sim` keeps its name referable even when another field is wrong, so the
        // error points at that row and not at every row that uses it.
        if (name !== undefined && !banks.has(nameKey(name))) {
            banks.set(nameKey(name), code ?? '');
        }
        if (name === undefined || code === undefined) {
            continue;
        }
        const uniqueCode = check.unique(row, 'codigo_febraban', bankCodes, code);
        const uniqueName = check.unique(row, 'nome', bankNames, nameKey(name));
        if (uniqueCode && uniqueName) {
            plan.banks.push({ file: row.file, line: row.line, name, febrabanCode: code });
        }
    }

    /* contas: by descricao */
    const accounts = new Map<string, string>();
    const accountKeys = new Map<string, number>();
    const accountNames = new Map<string, number>();
    for (const row of rows('contas.csv')) {
        const code = check.reference(row, 'banco', banks, 'bancos');
        const description = check.required(row, 'descricao', MAX.name);
        const type = check.oneOf<BankAccountType>(row, 'tipo', ACCOUNT_TYPES);
        const accountNumber = check.required(row, 'numero_conta', MAX.accountNumber);
        const opening = check.money(row, 'saldo_inicial');
        check.date(row, 'data_saldo');
        const overdraft = check.money(row, 'limite_cheque_especial', { optional: true });
        if (description !== undefined && !accounts.has(nameKey(description))) {
            accounts.set(nameKey(description), description);
        }
        if (
            code === undefined ||
            description === undefined ||
            type === undefined ||
            accountNumber === undefined ||
            opening === undefined ||
            overdraft === undefined
        ) {
            continue;
        }
        const uniqueKey = check.unique(
            row,
            'numero_conta',
            accountKeys,
            `${code}|${accountNumber}`,
        );
        const uniqueName = check.unique(row, 'descricao', accountNames, nameKey(description));
        if (uniqueKey && uniqueName) {
            plan.accounts.push({
                file: row.file,
                line: row.line,
                febrabanCode: code,
                description,
                type,
                accountNumber,
                openingBalanceCents: opening,
                overdraftLimitCents: overdraft,
            });
        }
    }

    /* cartoes: by nome */
    const cards = new Map<string, string>();
    const cardPayers = new Map<string, string>();
    const cardKeys = new Map<string, number>();
    const cardNames = new Map<string, number>();
    for (const row of rows('cartoes.csv')) {
        const code = check.reference(row, 'banco', banks, 'bancos');
        const name = check.required(row, 'nome', MAX.name);
        const limit = check.money(row, 'limite', { positive: true });
        const closingDay = check.integer(row, 'dia_fechamento', 1, 31);
        const dueDay = check.integer(row, 'dia_vencimento', 1, 31);
        const payer = check.reference(row, 'conta_pagadora', accounts, 'contas');
        if (name !== undefined && !cards.has(nameKey(name))) {
            cards.set(nameKey(name), name);
            cardPayers.set(nameKey(name), payer ?? '');
        }
        if (
            code === undefined ||
            name === undefined ||
            limit === undefined ||
            closingDay === undefined ||
            dueDay === undefined ||
            payer === undefined
        ) {
            continue;
        }
        const uniqueKey = check.unique(row, 'nome', cardKeys, `${code}|${nameKey(name)}`);
        // References are by name alone, so a name repeated across banks would be ambiguous.
        const uniqueName = uniqueKey && check.unique(row, 'nome', cardNames, nameKey(name));
        if (uniqueKey && uniqueName) {
            plan.cards.push({
                file: row.file,
                line: row.line,
                febrabanCode: code,
                name,
                creditLimitCents: limit,
                closingDay,
                dueDay,
                paymentAccount: payer,
            });
        }
    }

    /* tipos_despesa */
    const expenseTypes = new Map<string, string>();
    const typeNames = new Map<string, number>();
    for (const row of rows('tipos_despesa.csv')) {
        const name = check.required(row, 'nome', MAX.name);
        if (name !== undefined && check.unique(row, 'nome', typeNames, nameKey(name))) {
            expenseTypes.set(nameKey(name), name);
            plan.expenseTypes.push({ file: row.file, line: row.line, name });
        }
    }

    /* despesas_fixas e despesas_parceladas share the natural key space of expenses */
    const pushExpense = (row: Row, expense: PlannedExpense, seen: Map<string, number>): void => {
        const key = `${nameKey(expense.description)}|${targetKey(expense)}|${expense.occurredOn}`;
        if (check.unique(row, 'descricao', seen, key)) {
            plan.expenses.push(expense);
        }
    };

    const fixedKeys = new Map<string, number>();
    for (const row of rows('despesas_fixas.csv')) {
        const description = check.required(row, 'descricao');
        const expenseType = check.reference(row, 'tipo_despesa', expenseTypes, 'tipos_despesa');
        const amount = check.money(row, 'valor', { positive: true });
        const where = target(row, check, accounts, cards);
        const occurredOn = check.date(row, 'proxima_data');
        const endsOn = check.date(row, 'data_fim', true);
        const status = check.oneOf<CreationStatus>(row, 'situacao', CREATION_STATUSES);
        const notes = checkNotes(row, check, row.get('observacao') || undefined);
        if (endsOn !== undefined && occurredOn !== undefined && endsOn < occurredOn) {
            check.error('ERR-0019-06', row, 'data_fim', 'antes de proxima_data');
            continue;
        }
        if (
            description === undefined ||
            checkDescription(row, check, description) === undefined ||
            expenseType === undefined ||
            amount === undefined ||
            where === undefined ||
            occurredOn === undefined ||
            status === undefined ||
            (row.get('observacao') !== '' && notes === undefined)
        ) {
            continue;
        }
        pushExpense(
            row,
            {
                file: row.file,
                line: row.line,
                ...where,
                description,
                expenseType,
                kind: 'FIXED',
                amountCents: amount,
                occurredOn,
                status,
                ...(endsOn !== undefined && { recurrenceEndsOn: endsOn }),
                ...(notes !== undefined && { notes }),
            },
            fixedKeys,
        );
    }

    const installmentKeys = new Map<string, number>();
    for (const row of rows('despesas_parceladas.csv')) {
        const base = check.required(row, 'descricao');
        const expenseType = check.reference(row, 'tipo_despesa', expenseTypes, 'tipos_despesa');
        const amount = check.money(row, 'valor_parcela', { positive: true });
        const where = target(row, check, accounts, cards);
        const occurredOn = check.date(row, 'data_proxima_parcela');
        const next = check.integer(row, 'parcela_proxima', 1, MAX.installments);
        const total = check.integer(row, 'parcelas_total', 1, MAX.installments);
        const remaining = check.integer(row, 'parcelas_restantes', 1, MAX.installments);
        if (
            base === undefined ||
            expenseType === undefined ||
            amount === undefined ||
            where === undefined ||
            occurredOn === undefined ||
            next === undefined ||
            total === undefined ||
            remaining === undefined
        ) {
            continue;
        }
        checkInstallmentNumbering(row, check, next, total, remaining);
        const description = checkDescription(row, check, numbered(base, next, total, remaining));
        if (description === undefined) {
            continue;
        }
        pushExpense(
            row,
            {
                file: row.file,
                line: row.line,
                ...where,
                description,
                expenseType,
                ...(remaining === 1
                    ? { kind: 'VARIABLE' as const, amountCents: amount }
                    : {
                          kind: 'INSTALLMENT' as const,
                          amountCents: amount * remaining,
                          installmentTotal: remaining,
                      }),
                occurredOn,
                status: 'OPEN',
            },
            installmentKeys,
        );
    }

    /* faturas_em_aberto */
    const statementKeys = new Map<string, number>();
    for (const row of rows('faturas_em_aberto.csv')) {
        const card = check.reference(row, 'cartao', cards, 'cartoes');
        const dueOn = check.date(row, 'vencimento');
        const amount = check.money(row, 'valor', { positive: true });
        const expenseType = check.reference(row, 'tipo_despesa', expenseTypes, 'tipos_despesa');
        if (
            card === undefined ||
            dueOn === undefined ||
            amount === undefined ||
            expenseType === undefined
        ) {
            continue;
        }
        const statement: PlannedOpenStatement = {
            file: row.file,
            line: row.line,
            description: `Fatura anterior ${card} (vence ${dueOn})`,
            card,
            expenseType,
            amountCents: amount,
            dueOn,
            paymentAccount: cardPayers.get(nameKey(card))!,
        };
        if (
            check.unique(
                row,
                'cartao',
                statementKeys,
                `${nameKey(statement.description)}|${nameKey(card)}`,
            )
        ) {
            plan.openStatements.push(statement);
        }
    }

    /* recebimentos */
    const earningKeys = new Map<string, number>();
    for (const row of rows('recebimentos.csv')) {
        const base = check.required(row, 'descricao');
        const earningType = check.required(row, 'tipo_receita', MAX.name);
        const kind = check.oneOf(row, 'ocorrencia', KINDS);
        const value = check.money(row, 'valor', { positive: true });
        const account = check.reference(row, 'conta', accounts, 'contas');
        const occurredOn = check.date(row, 'proxima_data');
        const endsOn = check.date(row, 'data_fim', true);
        const status = check.oneOf<CreationStatus>(row, 'situacao', CREATION_STATUSES);
        const payer = row.get('pagante');
        const remark = row.get('observacao');
        const notes = checkNotes(
            row,
            check,
            payer !== '' && remark !== '' ? `${payer} — ${remark}` : payer || remark || undefined,
        );
        if (kind === undefined) {
            continue;
        }

        const installmentColumns = ['parcela_proxima', 'parcelas_total', 'parcelas_restantes'];
        let installments: { next: number; total: number; remaining: number } | undefined;
        let valid = true;
        if (kind === 'INSTALLMENT') {
            const next = check.integer(row, 'parcela_proxima', 1, MAX.installments);
            const total = check.integer(row, 'parcelas_total', 1, MAX.installments);
            const remaining = check.integer(row, 'parcelas_restantes', 2, MAX.installments);
            if (next === undefined || total === undefined || remaining === undefined) {
                valid = false;
            } else {
                installments = { next, total, remaining };
                checkInstallmentNumbering(row, check, next, total, remaining);
            }
        } else {
            for (const column of installmentColumns.filter((name) => row.get(name) !== '')) {
                check.error('ERR-0019-06', row, column, 'só em INSTALLMENT');
                valid = false;
            }
        }
        if (endsOn !== undefined && kind !== 'FIXED') {
            check.error('ERR-0019-06', row, 'data_fim', 'só em FIXED');
            valid = false;
        } else if (endsOn !== undefined && occurredOn !== undefined && endsOn < occurredOn) {
            check.error('ERR-0019-06', row, 'data_fim', 'antes de proxima_data');
            valid = false;
        }
        if (
            !valid ||
            base === undefined ||
            earningType === undefined ||
            value === undefined ||
            account === undefined ||
            occurredOn === undefined ||
            status === undefined ||
            (notes === undefined && (payer !== '' || remark !== ''))
        ) {
            continue;
        }
        const description = checkDescription(
            row,
            check,
            installments
                ? numbered(base, installments.next, installments.total, installments.remaining)
                : base,
        );
        if (description === undefined) {
            continue;
        }
        const earning: PlannedEarning = {
            file: row.file,
            line: row.line,
            description,
            earningType,
            kind,
            amountCents: installments ? value * installments.remaining : value,
            occurredOn,
            account,
            status,
            ...(installments && { installmentTotal: installments.remaining }),
            ...(endsOn !== undefined && { recurrenceEndsOn: endsOn }),
            ...(notes !== undefined && { notes }),
        };
        const key = `${nameKey(description)}|conta:${nameKey(account)}|${occurredOn}`;
        if (check.unique(row, 'descricao', earningKeys, key)) {
            plan.earnings.push(earning);
        }
    }

    return { plan, errors: check.errors, warnings: check.warnings, tabs: summaries() };
}
