import { moneyTransformer } from '../../../src/platform/database/money.transformer';

describe('moneyTransformer', () => {
    describe('to (aplicação → banco)', () => {
        it.each([
            [0, '0.00'],
            [5, '0.05'],
            [99, '0.99'],
            [100, '1.00'],
            [1234567, '12345.67'],
            [-1234567, '-12345.67'],
            [-5, '-0.05'],
            [99999999999999, '999999999999.99'],
        ])('converte %i centavos em %s', (cents, expected) => {
            expect(moneyTransformer.to(cents)).toBe(expected);
        });

        it('preserva null e undefined', () => {
            expect(moneyTransformer.to(null)).toBeNull();
            expect(moneyTransformer.to(undefined)).toBeNull();
        });

        it.each([1.5, 0.1, -0.01, NaN])('recusa o não inteiro %p', (value) => {
            expect(() => moneyTransformer.to(value)).toThrow(TypeError);
        });

        it('recusa valor que não é número', () => {
            expect(() => moneyTransformer.to('12.34')).toThrow(TypeError);
        });
    });

    describe('from (banco → aplicação)', () => {
        it.each([
            ['0.00', 0],
            ['0.05', 5],
            ['1.00', 100],
            ['12345.67', 1234567],
            ['-12345.67', -1234567],
            ['999999999999.99', 99999999999999],
            ['42', 4200],
            ['1.5', 150],
            ['  7.25  ', 725],
        ])('converte %s em %i centavos', (value, expected) => {
            expect(moneyTransformer.from(value)).toBe(expected);
        });

        it('preserva null e undefined', () => {
            expect(moneyTransformer.from(null)).toBeNull();
            expect(moneyTransformer.from(undefined)).toBeNull();
        });

        it('normaliza zero negativo', () => {
            expect(Object.is(moneyTransformer.from('-0.00'), 0)).toBe(true);
        });

        it.each(['12.345', 'abc', '', '1e3', '1.2.3'])('recusa %p', (value) => {
            expect(() => moneyTransformer.from(value)).toThrow(TypeError);
        });

        it('recusa valor acima do inteiro seguro do JavaScript', () => {
            // Fora da escala de numeric(14,2), mas a coluna errada existiria em silêncio.
            expect(() => moneyTransformer.from('99999999999999999.99')).toThrow(TypeError);
        });
    });

    describe('round-trip', () => {
        it.each([0, 1, -1, 99, 100, 250050, -250050, 99999999999999])(
            'preserva %i centavos na ida e na volta',
            (cents) => {
                expect(moneyTransformer.from(moneyTransformer.to(cents))).toBe(cents);
            },
        );

        it('não perde precisão onde o ponto flutuante perderia', () => {
            // 0.1 + 0.2 !== 0.3 em ponto flutuante; em centavos, é exato.
            const total = moneyTransformer.from('0.10') + moneyTransformer.from('0.20');

            expect(total).toBe(30);
            expect(moneyTransformer.to(total)).toBe('0.30');
        });
    });
});
