import type { EntityManager } from 'typeorm';

import type { CreditCardService } from '../../src/accounts';
import { StatementPeriodGuardService } from '../../src/statements';

const iso = (date: Date): string => date.toISOString().slice(0, 10);

const guardFor = (
    card: { closingDay: number; dueDay: number; createdAt: Date },
    lastClosesOn: string | null,
    now: string,
) => {
    jest.useFakeTimers({ now: new Date(`${now}T15:00:00.000Z`) });

    const creditCards = { findById: jest.fn().mockResolvedValue(card) };
    const manager = {
        getRepository: () => ({
            findOne: jest.fn().mockResolvedValue(lastClosesOn ? { closesOn: lastClosesOn } : null),
        }),
    } as unknown as EntityManager;
    const service = new StatementPeriodGuardService(creditCards as unknown as CreditCardService);

    return () => service.closedThrough(manager, 'card-id');
};

describe('StatementPeriodGuardService (spec 0013, A janela fechada)', () => {
    const card = { closingDay: 10, dueDay: 20, createdAt: new Date('2026-01-15T12:00:00Z') };

    afterEach(() => {
        jest.useRealTimers();
    });

    it('é o closesOn do último ciclo encadeado anterior a hoje, sem fatura registrada', async () => {
        const closedThrough = guardFor(card, null, '2026-03-20');

        expect(iso(await closedThrough())).toBe('2026-03-10');
    });

    it('no dia do fechamento o ciclo ainda não passou (closesOn < hoje)', async () => {
        const closedThrough = guardFor(card, null, '2026-03-10');

        expect(iso(await closedThrough())).toBe('2026-02-10');
    });

    it('sem nenhum ciclo passado, é o dia anterior ao primeiro ciclo', async () => {
        const closedThrough = guardFor(
            { ...card, createdAt: new Date('2026-03-20T12:00:00Z') },
            null,
            '2026-03-20',
        );

        expect(iso(await closedThrough())).toBe('2026-03-10');
    });

    it('continua da última fatura registrada, mesmo depois de mudar o closing_day', async () => {
        const closedThrough = guardFor({ ...card, closingDay: 25 }, '2026-03-10', '2026-04-01');

        // The cycle after the 03-10 statement now closes on 03-25 (INV-0013-03).
        expect(iso(await closedThrough())).toBe('2026-03-25');
    });

    it('devolve meio-dia UTC, para o expenses reconverter para o mesmo dia de negócio', async () => {
        const closedThrough = guardFor(card, null, '2026-03-20');

        expect((await closedThrough()).toISOString()).toBe('2026-03-10T12:00:00.000Z');
    });
});
