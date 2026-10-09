import { createExpenseSchema } from '../../src/expenses/expense.schemas';
import { splitCents } from '../../src/platform/money';
import { monthlyInstallmentDates } from '../../src/platform/monthly-dates';

const ID = '00000000-0000-4000-8000-000000000001';
const base = {
    description: 'Notebook',
    expenseTypeId: ID,
    kind: 'INSTALLMENT',
    amountCents: 10000,
    occurredOn: '2026-03-10',
    bankAccountId: ID,
    installmentTotal: 3,
};

const issuePaths = (input: unknown): string[] => {
    const result = createExpenseSchema.safeParse(input);

    return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('parcelamento (unidade)', () => {
    it('AC-0012-07, INV-0012-06: rateia 10000 em 3 com o resto na primeira e soma o total', () => {
        const parts = splitCents(10000, 3);

        expect(parts).toEqual([3334, 3333, 3333]);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(10000);
    });

    it('AC-0012-08: 31/01 em 3x preserva o dia (28/02, 31/03; 29/02 em bissexto)', () => {
        expect(monthlyInstallmentDates('2027-01-31', 3)).toEqual([
            '2027-01-31',
            '2027-02-28',
            '2027-03-31',
        ]);
        expect(monthlyInstallmentDates('2028-01-31', 3)[1]).toBe('2028-02-29');
    });

    it('AC-0012-08: 30/01 em 3x dá 30/01, 28/02 e 30/03', () => {
        expect(monthlyInstallmentDates('2027-01-30', 3)).toEqual([
            '2027-01-30',
            '2027-02-28',
            '2027-03-30',
        ]);
    });

    it('ERR-0012-07: INSTALLMENT exige installmentTotal entre 2 e 120', () => {
        expect(issuePaths(base)).toEqual([]);
        expect(issuePaths({ ...base, installmentTotal: 120 })).toEqual([]);

        for (const installmentTotal of [undefined, 1, 121, 2.5, '3']) {
            expect(issuePaths({ ...base, installmentTotal })).toContain('installmentTotal');
        }
    });
});
