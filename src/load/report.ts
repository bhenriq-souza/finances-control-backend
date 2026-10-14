import type { LoadError, LoadWarning, TabSummary, Validation } from './validate';

const where = (item: { file: string; line?: number; column?: string }): string => {
    const place = item.line === undefined ? item.file : `${item.file}:${item.line}`;
    return item.column === undefined ? place : `${place} ${item.column}`;
};

/** `contas.csv:5 numero_conta: repetido na linha 4 (ERR-0019-05)` — spec 0019, _Error cases_. */
export const formatError = (error: LoadError): string =>
    `${where(error)}: ${error.message} (${error.code})`;

export const formatWarning = (warning: LoadWarning): string =>
    `aviso ${where(warning)}: ${warning.message}`;

/** Integer cents as `R$ 7.649,45`, without floating point. */
export const formatReais = (cents: number): string => {
    const reais = Math.trunc(cents / 100)
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `R$ ${reais},${String(cents % 100).padStart(2, '0')}`;
};

const formatTab = (tab: TabSummary): string =>
    `${tab.file.padEnd(24)} a importar: ${String(tab.toImport).padStart(3)}   ignorados (importar = não): ${String(tab.ignored).padStart(3)}`;

/** All the validation errors together (INV-0019-01), or the plan and its warnings. */
export function formatValidation(validation: Validation): string[] {
    if (validation.errors.length > 0) {
        return [
            `${validation.errors.length} erro(s) de validação; nada foi gravado.`,
            ...validation.errors.map(formatError),
        ];
    }

    const { plan } = validation;
    return [
        'Plano da carga:',
        ...validation.tabs.map(formatTab),
        `tipos de despesa ativos ao final: ${plan.expenseTypes.length}; os demais serão arquivados`,
        ...plan.openStatements.map(
            (statement) =>
                `lembrete: em ${statement.dueOn}, registre o pagamento antecipado de ${formatReais(statement.amountCents)} da fatura aberta do cartão ${statement.card}, pela conta ${statement.paymentAccount}`,
        ),
        ...validation.warnings.map(formatWarning),
    ];
}
