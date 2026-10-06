import { inject, injectable } from 'tsyringe';

import type { ILogger } from '@bhs-dev/typescript-common-types';
import { LoggerServiceSymbol } from '../symbols';
import type { DomainEvent } from './domain-event';
import type {
    DomainEventDispatcher,
    DomainEventHandler,
    Unsubscribe,
} from './domain-event-dispatcher';

type AnyHandler = DomainEventHandler<DomainEvent>;

/**
 * Dispatcher em memória: entrega em ordem, um handler por vez, com falha
 * isolada e logada (INV-0004-04, INV-0004-05).
 */
@injectable()
export class InProcessDomainEventDispatcher implements DomainEventDispatcher {
    private readonly handlers = new Map<string, Set<AnyHandler>>();

    constructor(@inject(LoggerServiceSymbol) private readonly logger: ILogger) {}

    subscribe<TEvent extends DomainEvent>(
        name: TEvent['name'],
        handler: DomainEventHandler<TEvent>,
    ): Unsubscribe {
        const registered = handler as unknown as AnyHandler;
        let set = this.handlers.get(name);

        if (!set) {
            set = new Set();
            this.handlers.set(name, set);
        }

        set.add(registered);

        return () => {
            this.handlers.get(name)?.delete(registered);
        };
    }

    async dispatch(events: readonly DomainEvent[]): Promise<void> {
        for (const event of events) {
            // Cópia: inscrições feitas durante o despacho não afetam este evento.
            const handlers = [...(this.handlers.get(event.name) ?? [])];

            this.logger.debug('domain event dispatched', {
                event: event.name,
                handlers: handlers.length,
                correlationId: event.correlationId,
            });

            for (const handler of handlers) {
                try {
                    await handler(event);
                } catch (error) {
                    this.logger.error('domain event handler failed', {
                        event: event.name,
                        handler: handler.name || 'anonymous',
                        correlationId: event.correlationId,
                        error: error instanceof Error ? error.message : String(error),
                        stack: error instanceof Error ? error.stack : undefined,
                    });
                }
            }
        }
    }
}
