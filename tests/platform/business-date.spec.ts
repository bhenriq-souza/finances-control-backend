import { BUSINESS_TIME_ZONE, businessToday } from '../../src/platform/business-date';

describe('businessToday (INV-0012-16, AC-0012-24)', () => {
    it('usa o fuso America/Sao_Paulo', () => {
        expect(BUSINESS_TIME_ZONE).toBe('America/Sao_Paulo');
    });

    it('22h do dia 10 em Brasília ainda é dia 10, embora seja dia 11 em UTC', () => {
        expect(businessToday(new Date('2026-03-11T01:00:00Z'))).toBe('2026-03-10');
    });

    it('logo após a meia-noite em Brasília já é o dia seguinte', () => {
        expect(businessToday(new Date('2026-03-11T03:00:00Z'))).toBe('2026-03-11');
    });

    it('sem argumento devolve YYYY-MM-DD', () => {
        expect(businessToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});
