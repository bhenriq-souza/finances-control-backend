import { cycleFor, type BillingCycle } from '../../src/accounts/billing-cycle';

/** Datas de calendário em UTC, para o teste dizer exatamente o que quer dizer. */
const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const iso = (date: Date): string => date.toISOString().slice(0, 10);

const asIso = (cycle: BillingCycle) => ({
    startsOn: iso(cycle.startsOn),
    closesOn: iso(cycle.closesOn),
    dueOn: iso(cycle.dueOn),
});

describe('cycleFor (spec 0011)', () => {
    describe('o ciclo a que a referência pertence', () => {
        const card = { closingDay: 10, dueDay: 20 };

        it('antes do fechamento, é o ciclo que fecha neste mês', () => {
            expect(asIso(cycleFor(card, d('2026-03-04')))).toEqual({
                startsOn: '2026-02-11',
                closesOn: '2026-03-10',
                dueOn: '2026-03-20',
            });
        });

        it('no próprio dia do fechamento, ainda é este ciclo', () => {
            expect(asIso(cycleFor(card, d('2026-03-10'))).closesOn).toBe('2026-03-10');
        });

        it('no dia seguinte, já é o próximo', () => {
            expect(asIso(cycleFor(card, d('2026-03-11')))).toEqual({
                startsOn: '2026-03-11',
                closesOn: '2026-04-10',
                dueOn: '2026-04-20',
            });
        });

        it('a hora da referência não importa: o ciclo é calendário', () => {
            const madrugada = new Date('2026-03-10T23:59:59.999Z');

            expect(asIso(cycleFor(card, madrugada)).closesOn).toBe('2026-03-10');
        });
    });

    describe('dia que não existe no mês resolve para o último (AC-0011-05)', () => {
        const card = { closingDay: 31, dueDay: 31 };

        it.each([
            ['2026-02-05', '2026-02-28'],
            ['2026-04-15', '2026-04-30'],
            ['2026-06-01', '2026-06-30'],
            ['2026-01-20', '2026-01-31'],
        ])('referência em %s fecha em %s', (reference, expected) => {
            expect(asIso(cycleFor(card, d(reference))).closesOn).toBe(expected);
        });

        it('fevereiro bissexto fecha no dia 29', () => {
            expect(asIso(cycleFor(card, d('2028-02-10'))).closesOn).toBe('2028-02-29');
        });

        it('nenhum mês do ano fica sem fatura', () => {
            const fechamentos = Array.from({ length: 12 }, (_unused, month) =>
                iso(cycleFor(card, new Date(Date.UTC(2026, month, 1))).closesOn).slice(0, 7),
            );

            expect(new Set(fechamentos).size).toBe(12);
        });
    });

    describe('vencimento (AC-0011-06)', () => {
        it('anterior ao fechamento cai no mês seguinte', () => {
            expect(asIso(cycleFor({ closingDay: 28, dueDay: 5 }, d('2026-03-10')))).toEqual({
                startsOn: '2026-03-01',
                closesOn: '2026-03-28',
                dueOn: '2026-04-05',
            });
        });

        it('no mesmo dia do fechamento também cai no mês seguinte', () => {
            expect(asIso(cycleFor({ closingDay: 15, dueDay: 15 }, d('2026-03-10'))).dueOn).toBe(
                '2026-04-15',
            );
        });

        it('posterior ao fechamento fica no mesmo mês', () => {
            expect(asIso(cycleFor({ closingDay: 5, dueDay: 20 }, d('2026-03-03'))).dueOn).toBe(
                '2026-03-20',
            );
        });

        it('atravessa a virada do ano', () => {
            expect(asIso(cycleFor({ closingDay: 28, dueDay: 5 }, d('2026-12-20')))).toEqual({
                startsOn: '2026-11-29',
                closesOn: '2026-12-28',
                dueOn: '2027-01-05',
            });
        });

        it('nunca empata com o fechamento: fechar dia 30 e vencer dia 31', () => {
            // Os dois resolvem para 28 de fevereiro; uma fatura com zero dia para
            // pagar não é fatura. O vencimento vai para o mês seguinte.
            expect(asIso(cycleFor({ closingDay: 30, dueDay: 31 }, d('2026-02-10')))).toEqual({
                // O ciclo anterior fechou em 30 de janeiro, não em 31.
                startsOn: '2026-01-31',
                closesOn: '2026-02-28',
                dueOn: '2026-03-31',
            });
        });

        it('vencimento no dia 31 resolve para o último dia do mês', () => {
            expect(asIso(cycleFor({ closingDay: 5, dueDay: 31 }, d('2026-02-03'))).dueOn).toBe(
                '2026-02-28',
            );
        });
    });

    describe('ciclos consecutivos são contíguos (AC-0011-07, INV-0011-08)', () => {
        const cards = [
            { closingDay: 10, dueDay: 20 },
            { closingDay: 31, dueDay: 10 },
            { closingDay: 1, dueDay: 15 },
            { closingDay: 28, dueDay: 5 },
            { closingDay: 29, dueDay: 29 },
            { closingDay: 30, dueDay: 31 },
        ];

        it.each(cards)('fechamento %j, dois anos seguidos', (card) => {
            let cycle = cycleFor(card, d('2026-01-15'));

            for (let index = 0; index < 24; index += 1) {
                const next = cycleFor(card, new Date(cycle.closesOn.getTime() + 86_400_000));

                // Sem buraco e sem sobreposição: começa exatamente no dia seguinte.
                expect(iso(next.startsOn)).toBe(
                    iso(new Date(cycle.closesOn.getTime() + 86_400_000)),
                );
                expect(next.closesOn.getTime()).toBeGreaterThan(cycle.closesOn.getTime());

                cycle = next;
            }
        });

        it('a janela nunca é vazia nem invertida', () => {
            for (const card of cards) {
                const cycle = cycleFor(card, d('2026-02-14'));

                expect(cycle.startsOn.getTime()).toBeLessThanOrEqual(cycle.closesOn.getTime());
                expect(cycle.dueOn.getTime()).toBeGreaterThan(cycle.closesOn.getTime());
            }
        });
    });

    describe('configuração inválida', () => {
        it.each([0, 32, -1, 1.5, Number.NaN])('recusa dia %p', (day) => {
            expect(() => cycleFor({ closingDay: day, dueDay: 10 }, d('2026-03-01'))).toThrow(
                TypeError,
            );
            expect(() => cycleFor({ closingDay: 10, dueDay: day }, d('2026-03-01'))).toThrow(
                TypeError,
            );
        });
    });
});
