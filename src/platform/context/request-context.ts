import { AsyncLocalStorage } from 'node:async_hooks';
import { singleton } from 'tsyringe';

export type RequestStore = {
    correlationId: string;
    startedAt: number;
};

/**
 * Contexto por requisição via AsyncLocalStorage: permite que qualquer camada
 * recupere o correlation-id sem recebê-lo por parâmetro em toda a cadeia.
 */
@singleton()
export class RequestContext {
    private readonly storage = new AsyncLocalStorage<RequestStore>();

    run<T>(store: RequestStore, callback: () => T): T {
        return this.storage.run(store, callback);
    }

    get(): RequestStore | undefined {
        return this.storage.getStore();
    }

    getCorrelationId(): string | undefined {
        return this.storage.getStore()?.correlationId;
    }
}
