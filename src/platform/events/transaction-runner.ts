import { inject, injectable } from 'tsyringe';
import type { DataSource, EntityManager } from 'typeorm';

import type { RequestContext } from '../context/request-context';
import {
    DatabaseConnectionSymbol,
    DomainEventDispatcherSymbol,
    RequestContextSymbol,
} from '../symbols';
import type { DomainEvent } from './domain-event';
import type { DomainEventDispatcher } from './domain-event-dispatcher';

export type TransactionScope = {
    readonly manager: EntityManager;
    publish(event: Omit<DomainEvent, 'occurredAt' | 'correlationId'>): void;
};

export interface TransactionRunner {
    run<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T>;
}

/**
 * Único caminho para publicar um evento: acumula no escopo e só despacha depois
 * do commit; no rollback descarta (INV-0004-01, INV-0004-02).
 */
@injectable()
export class DataSourceTransactionRunner implements TransactionRunner {
    constructor(
        @inject(DomainEventDispatcherSymbol) private readonly dispatcher: DomainEventDispatcher,
        @inject(DatabaseConnectionSymbol) private readonly dataSource: DataSource,
        @inject(RequestContextSymbol) private readonly requestContext: RequestContext,
    ) {}

    async run<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T> {
        const events: DomainEvent[] = [];

        const result = await this.dataSource.transaction(async (manager) => {
            let closed = false;
            const scope: TransactionScope = {
                manager,
                publish: (event) => {
                    if (closed) throw new Error('transaction scope is closed');

                    events.push({
                        ...event,
                        occurredAt: new Date(),
                        correlationId: this.requestContext.getCorrelationId() ?? null,
                    });
                },
            };

            try {
                return await work(scope);
            } finally {
                closed = true;
            }
        });

        await this.dispatcher.dispatch(events);

        return result;
    }
}
