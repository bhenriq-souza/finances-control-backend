import { AsyncLocalStorage } from 'node:async_hooks';
import { singleton } from 'tsyringe';

export type RequestStore = {
    correlationId: string;
    startedAt: number;
    /**
     * Preenchidos pela autenticação (spec 0010). Ficam aqui, e não numa entidade,
     * porque `platform` não pode conhecer módulo de domínio (INV-0003-09) — o
     * perfil trafega como texto e quem o interpreta é o `identity`.
     */
    userId?: string;
    userProfile?: string | null;
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

    /** Chamado uma vez por requisição, pela autenticação. */
    setUser(userId: string, userProfile: string | null): void {
        const store = this.storage.getStore();

        if (!store) return;

        store.userId = userId;
        store.userProfile = userProfile;
    }
}
