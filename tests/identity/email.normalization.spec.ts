import { normalizeEmail } from '../../src/identity/email';

describe('normalizeEmail (INV-0010-08)', () => {
    it.each([
        ['bruno@exemplo.com', 'bruno@exemplo.com'],
        ['Bruno@Exemplo.com', 'bruno@exemplo.com'],
        ['  bruno@exemplo.com  ', 'bruno@exemplo.com'],
        ['\tBRUNO@EXEMPLO.COM\n', 'bruno@exemplo.com'],
    ])('normaliza %p em %p', (input, expected) => {
        expect(normalizeEmail(input)).toBe(expected);
    });

    it('resolve variações do mesmo email para uma forma só (AC-0010-11)', () => {
        const variations = ['bruno@exemplo.com', 'Bruno@Exemplo.COM', ' bruno@exemplo.com '];

        expect(new Set(variations.map(normalizeEmail)).size).toBe(1);
    });

    it('não confunde emails diferentes', () => {
        expect(normalizeEmail('bruno@exemplo.com')).not.toBe(
            normalizeEmail('bruno@exemplo.com.br'),
        );
    });

    it('é idempotente', () => {
        const once = normalizeEmail(' Bruno@Exemplo.com ');

        expect(normalizeEmail(once)).toBe(once);
    });
});
