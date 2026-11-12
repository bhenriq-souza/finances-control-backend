import { normalizeSearchText } from '../../src/expenses/expense-type.search';

describe('normalizeSearchText (AC-0026-08)', () => {
    it('remove acentos, caixa e espaços das pontas', () => {
        expect(normalizeSearchText('Ação')).toBe('acao');
        expect(normalizeSearchText(' CAFÉ')).toBe('cafe');
    });

    it('é idempotente', () => {
        const once = normalizeSearchText('  ALIMENTAÇÃO ');
        expect(normalizeSearchText(once)).toBe(once);
    });

    it('mantém %, _ e \\ como literais (INV-0026-03)', () => {
        expect(normalizeSearchText('100% _ \\')).toBe('100% _ \\');
    });
});
