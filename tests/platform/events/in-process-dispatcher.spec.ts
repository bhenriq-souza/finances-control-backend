import 'reflect-metadata';
import type { ILogger } from '@bhs-dev/typescript-common-types';

import type { DomainEvent, DomainEventDispatcher } from '../../../src/platform';
import { InProcessDomainEventDispatcher } from '../../../src/platform/events/in-process-domain-event-dispatcher';

function makeLogger() {
    return {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        child: jest.fn(),
    } as unknown as jest.Mocked<ILogger>;
}

function makeEvent(name: string, correlationId: string | null = 'corr-1'): DomainEvent {
    return {
        name,
        occurredAt: new Date('2026-01-01T00:00:00Z'),
        correlationId,
        payload: { id: name },
    };
}

describe('InProcessDomainEventDispatcher', () => {
    let logger: jest.Mocked<ILogger>;
    let dispatcher: DomainEventDispatcher;

    beforeEach(() => {
        logger = makeLogger();
        dispatcher = new InProcessDomainEventDispatcher(logger);
    });

    it('AC-0004-01: entrega o evento completo só ao handler do seu nome', async () => {
        const handler = jest.fn();
        const other = jest.fn();
        const event = makeEvent('ExpenseCreated');

        dispatcher.subscribe('ExpenseCreated', handler);
        dispatcher.subscribe('ExpensePaid', other);
        await dispatcher.dispatch([event]);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(event);
        expect(other).not.toHaveBeenCalled();
    });

    it('AC-0004-02 / INV-0004-05: ordem evento -> handler e handler seguinte só após o anterior resolver', async () => {
        const calls: string[] = [];
        const a = async (e: DomainEvent) => {
            calls.push(`A:start:${e.payload.id}`);
            await new Promise((resolve) => setTimeout(resolve, 20));
            calls.push(`A:end:${e.payload.id}`);
        };
        const b = (e: DomainEvent) => {
            calls.push(`B:${e.payload.id}`);
        };

        dispatcher.subscribe('E1', a);
        dispatcher.subscribe('E1', b);
        dispatcher.subscribe('E2', a);
        dispatcher.subscribe('E2', b);
        await dispatcher.dispatch([makeEvent('E1'), makeEvent('E2')]);

        expect(calls).toEqual(['A:start:E1', 'A:end:E1', 'B:E1', 'A:start:E2', 'A:end:E2', 'B:E2']);
    });

    it('AC-0004-03 / ERR-0004-01 / INV-0004-04: handler que lança não impede os demais e é logado uma vez', async () => {
        const calls: string[] = [];
        function failing(): void {
            throw new Error('boom');
        }
        const next = jest.fn((e: DomainEvent) => {
            calls.push(e.name);
        });

        dispatcher.subscribe('E1', failing);
        dispatcher.subscribe('E1', next);
        dispatcher.subscribe('E2', next);

        await expect(
            dispatcher.dispatch([makeEvent('E1'), makeEvent('E2')]),
        ).resolves.toBeUndefined();

        expect(calls).toEqual(['E1', 'E2']);
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                event: 'E1',
                handler: 'failing',
                correlationId: 'corr-1',
                error: 'boom',
            }),
        );
    });

    it('ERR-0004-01: handler que rejeita e é anônimo é logado como anonymous', async () => {
        dispatcher.subscribe('E1', () => Promise.reject(new Error('nope')));

        await expect(dispatcher.dispatch([makeEvent('E1')])).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ event: 'E1', handler: 'anonymous', correlationId: 'corr-1' }),
        );
    });

    it('AC-0004-04 / ERR-0004-04: mesma inscrição duas vezes chama uma vez; Unsubscribe remove', async () => {
        const handler = jest.fn();

        dispatcher.subscribe('E1', handler);
        const unsubscribe = dispatcher.subscribe('E1', handler);
        await dispatcher.dispatch([makeEvent('E1')]);

        expect(handler).toHaveBeenCalledTimes(1);

        unsubscribe();
        await dispatcher.dispatch([makeEvent('E1')]);

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('ERR-0004-06: evento sem handler não é erro e loga debug com handlers: 0', async () => {
        await expect(dispatcher.dispatch([makeEvent('Nobody', null)])).resolves.toBeUndefined();

        expect(logger.debug).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ event: 'Nobody', handlers: 0, correlationId: null }),
        );
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('loga debug por evento despachado com a quantidade de handlers', async () => {
        dispatcher.subscribe('E1', jest.fn());
        dispatcher.subscribe('E1', jest.fn());
        await dispatcher.dispatch([makeEvent('E1')]);

        expect(logger.debug).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ event: 'E1', handlers: 2, correlationId: 'corr-1' }),
        );
    });
});
