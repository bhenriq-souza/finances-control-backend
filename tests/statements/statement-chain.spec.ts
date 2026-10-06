import type { BillingCycle } from '../../src/accounts';
import { chainCycles, cycleContaining, nextCycle } from '../../src/statements';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const iso = (date: Date): string => date.toISOString().slice(0, 10);
const asIso = (cycle: BillingCycle) => ({
    startsOn: iso(cycle.startsOn),
    closesOn: iso(cycle.closesOn),
    dueOn: iso(cycle.dueOn),
});

const DAY_MS = 24 * 60 * 60 * 1000;

describe('encadeamento dos ciclos (spec 0013)', () => {
    describe('AC-0013-02 / INV-0013-01: a fatura é determinada só pelo postedOn', () => {
        const card = { closingDay: 10, dueDay: 20 };
        const anchor = { lastClosedClosesOn: null, createdOn: d('2026-01-15') };

        it('10/03 cai na fatura que fecha em 10/03; 11/03 e 10/04 na que fecha em 10/04', () => {
            expect(iso(cycleContaining(card, anchor, d('2026-03-10')).closesOn)).toBe('2026-03-10');
            expect(iso(cycleContaining(card, anchor, d('2026-03-11')).closesOn)).toBe('2026-04-10');
            expect(iso(cycleContaining(card, anchor, d('2026-04-10')).closesOn)).toBe('2026-04-10');
        });

        it('uma compra de 10/03 lançada com postedOn 11/03 cai na fatura de 10/04', () => {
            // O que decide a fatura é o postedOn, não o occurredOn.
            expect(iso(cycleContaining(card, anchor, d('2026-03-11')).closesOn)).toBe('2026-04-10');
        });
    });

    describe('AC-0013-03 / INV-0013-03 / INV-0013-04: mudança de closing_day', () => {
        const closed = d('2026-03-10');
        const anchor = { lastClosedClosesOn: closed, createdOn: d('2026-01-15') };

        it('closing_day 5: a seguinte vai de 11/03 a 05/04', () => {
            const next = nextCycle({ closingDay: 5, dueDay: 20 }, closed);

            expect(iso(next.startsOn)).toBe('2026-03-11');
            expect(iso(next.closesOn)).toBe('2026-04-05');
        });

        it('closing_day 25: a seguinte vai de 11/03 a 25/03', () => {
            const next = nextCycle({ closingDay: 25, dueDay: 30 }, closed);

            expect(iso(next.startsOn)).toBe('2026-03-11');
            expect(iso(next.closesOn)).toBe('2026-03-25');
        });

        it.each([1, 5, 10, 25, 31])(
            'closing_day %i: ciclos contíguos, sem sobreposição e sem data sem fatura',
            (closingDay) => {
                const cycles = chainCycles({ closingDay, dueDay: 15 }, anchor, 8);

                expect(iso(cycles[0]!.startsOn)).toBe('2026-03-11');
                for (let i = 0; i < cycles.length; i += 1) {
                    expect(cycles[i]!.startsOn.getTime()).toBeLessThanOrEqual(
                        cycles[i]!.closesOn.getTime(),
                    );
                    if (i > 0) {
                        expect(
                            cycles[i]!.startsOn.getTime() - cycles[i - 1]!.closesOn.getTime(),
                        ).toBe(DAY_MS);
                    }
                }
            },
        );

        it('o encadeamento parte do fechamento gravado, não da configuração atual', () => {
            // Sem o encadeamento, `cycleFor` com closing_day 5 começaria em 06/03,
            // sobrepondo a fatura que já fechou em 10/03.
            const [next] = chainCycles({ closingDay: 5, dueDay: 3 }, anchor, 1);

            expect(iso(next!.startsOn)).toBe('2026-03-11');
        });
    });

    describe('AC-0013-04 / INV-0013-04: mudança de due_day', () => {
        it('a fechada guarda o dueOn; a aberta usa o novo (Santander, dia 5 para dia 3)', () => {
            const closed = asIso(
                chainCycles(
                    { closingDay: 25, dueDay: 5 },
                    { lastClosedClosesOn: null, createdOn: d('2026-03-01') },
                    1,
                )[0]!,
            );
            const open = asIso(nextCycle({ closingDay: 25, dueDay: 3 }, d(closed.closesOn)));

            expect(closed).toEqual({
                startsOn: '2026-02-26',
                closesOn: '2026-03-25',
                dueOn: '2026-04-05',
            });
            expect(open).toEqual({
                startsOn: '2026-03-26',
                closesOn: '2026-04-25',
                dueOn: '2026-05-03',
            });
        });
    });

    it('o primeiro ciclo de um cartão é o da data de cadastro', () => {
        const [first] = chainCycles(
            { closingDay: 10, dueDay: 20 },
            { lastClosedClosesOn: null, createdOn: d('2026-03-04') },
            1,
        );

        expect(asIso(first!)).toEqual({
            startsOn: '2026-02-11',
            closesOn: '2026-03-10',
            dueOn: '2026-03-20',
        });
    });
});
