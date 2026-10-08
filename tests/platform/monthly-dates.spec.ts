import { addMonths, monthlyInstallmentDates } from '../../src/platform/monthly-dates';

describe('addMonths', () => {
    it('mantém o dia quando ele existe no mês de destino', () => {
        expect(addMonths('2026-03-05', 1)).toBe('2026-04-05');
    });

    it('resolve dia inexistente para o último dia do mês', () => {
        expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
        expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
    });

    it('fevereiro de ano bissexto termina em 29', () => {
        expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    });

    it('preserva o dia original nos meses seguintes', () => {
        expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
    });

    it('vira o ano e aceita zero meses', () => {
        expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
        expect(addMonths('2026-11-15', 0)).toBe('2026-11-15');
    });

    it('recusa data malformada ou inexistente e meses fracionados', () => {
        expect(() => addMonths('2026-02-30', 1)).toThrow(TypeError);
        expect(() => addMonths('26-02-01', 1)).toThrow(TypeError);
        expect(() => addMonths('2026-02-01', 1.5)).toThrow(TypeError);
    });
});

describe('monthlyInstallmentDates (AC-0014-14)', () => {
    it('31/01 → 28/02 → 31/03', () => {
        expect(monthlyInstallmentDates('2026-01-31', 3)).toEqual([
            '2026-01-31',
            '2026-02-28',
            '2026-03-31',
        ]);
    });

    it('em ano bissexto a segunda parcela cai em 29/02', () => {
        expect(monthlyInstallmentDates('2028-01-31', 3)[1]).toBe('2028-02-29');
    });
});
