import type { DomainEvent } from './domain-event';

export type DomainEventHandler<TEvent extends DomainEvent = DomainEvent> = (
    event: TEvent,
) => Promise<void> | void;

export type Unsubscribe = () => void;

/** Porta do dispatcher: módulos dependem dela, nunca da implementação (INV-0004-09). */
export interface DomainEventDispatcher {
    subscribe<TEvent extends DomainEvent>(
        name: TEvent['name'],
        handler: DomainEventHandler<TEvent>,
    ): Unsubscribe;
    dispatch(events: readonly DomainEvent[]): Promise<void>;
}
