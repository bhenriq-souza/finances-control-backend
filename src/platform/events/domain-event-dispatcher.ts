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

/**
 * Contrato de um consumidor de eventos: o módulo exporta uma classe que o implementa e a declara
 * em `ApiModule.subscribers`; a composição chama `subscribe` uma vez (spec 0004).
 */
export interface DomainEventSubscriber {
    subscribe(dispatcher: DomainEventDispatcher): void;
}
