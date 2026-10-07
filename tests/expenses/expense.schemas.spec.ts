import { createExpenseSchema } from '../../src/expenses/expense.schemas';

const ID = '00000000-0000-4000-8000-000000000001';
const base = {
    description: '  Aluguel ',
    expenseTypeId: ID,
    kind: 'VARIABLE',
    amountCents: 1000,
    occurredOn: '2026-03-10',
    bankAccountId: ID,
};

const issuePaths = (input: unknown): string[] => {
    const result = createExpenseSchema.safeParse(input);

    return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('createExpenseSchema (unidade)', () => {
    it('aplica status OPEN por padrão e faz trim da descrição', () => {
        expect(createExpenseSchema.parse(base)).toMatchObject({
            status: 'OPEN',
            description: 'Aluguel',
        });
    });

    it('ERR-0012-03: exige exatamente um entre conta e cartão', () => {
        expect(issuePaths({ ...base, creditCardId: ID })).toEqual(
            expect.arrayContaining(['bankAccountId', 'creditCardId']),
        );
        expect(issuePaths({ ...base, bankAccountId: undefined })).toEqual(
            expect.arrayContaining(['bankAccountId', 'creditCardId']),
        );
    });

    it('ERR-0012-17: postedOn só com cartão e nunca antes de occurredOn', () => {
        expect(issuePaths({ ...base, postedOn: '2026-03-10' })).toContain('postedOn');
        expect(
            issuePaths({
                ...base,
                bankAccountId: undefined,
                creditCardId: ID,
                postedOn: '2026-03-09',
            }),
        ).toContain('postedOn');
        expect(
            issuePaths({
                ...base,
                bankAccountId: undefined,
                creditCardId: ID,
                postedOn: '2026-03-10',
            }),
        ).toEqual([]);
    });

    it('ERR-0012-12: amountCents precisa ser inteiro positivo', () => {
        for (const amountCents of [0, -1, 1.5, '10']) {
            expect(issuePaths({ ...base, amountCents })).toContain('amountCents');
        }
    });

    it('ERR-0012-14: status só OPEN, FORECAST ou VERIFYING', () => {
        expect(issuePaths({ ...base, status: 'PAID' })).toContain('status');
        expect(issuePaths({ ...base, status: 'FORECAST' })).toEqual([]);
    });

    it('ERR-0012-07: installmentTotal é proibido em FIXED e VARIABLE', () => {
        expect(issuePaths({ ...base, installmentTotal: 3 })).toContain('installmentTotal');
    });

    it('recusa campo desconhecido', () => {
        expect(createExpenseSchema.safeParse({ ...base, currentBalanceCents: 1 }).success).toBe(
            false,
        );
    });
});
