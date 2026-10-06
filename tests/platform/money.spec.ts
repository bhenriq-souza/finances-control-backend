import { splitCents } from '../../src/platform/money';

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

describe('splitCents (AC-0012-20)', () => {
    it('absorve o resto na primeira parte', () => {
        expect(splitCents(10000, 3)).toEqual([3334, 3333, 3333]);
        expect(splitCents(1, 3)).toEqual([1, 0, 0]);
    });

    it('com uma parte devolve o total', () => {
        expect(splitCents(12345, 1)).toEqual([12345]);
    });

    it('a soma é sempre o total', () => {
        for (const total of [1, 7, 99, 10000, 123457, 99999999]) {
            for (const parts of [1, 2, 3, 7, 12, 60, 120]) {
                const split = splitCents(total, parts);
                expect(split).toHaveLength(parts);
                expect(sum(split)).toBe(total);
            }
        }
    });

    it.each([0, -1, 1.5, Number.NaN])('lança TypeError para parts = %s', (parts) => {
        expect(() => splitCents(100, parts)).toThrow(TypeError);
    });
});
