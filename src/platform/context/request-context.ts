import { AsyncLocalStorage } from 'node:async_hooks';
import { singleton } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';

export type RequestStore = {
    correlationId: string;
    startedAt: number;
    /**
     * Preenchidos pela autenticação (spec 0010). Ficam aqui, e não numa entidade,
     * porque `platform` não pode conhecer módulo de domínio (INV-0003-09) — o
     * perfil trafega como texto e quem o interpreta é o `identity`.
     *
     * Espaço e perfil vêm do membro (`workspace_members`), e a marca de admin da
     * plataforma vem de `users`, lidos do banco na própria requisição, nunca do
     * token (spec 0021, INV-0021-05).
     */
    userId?: string;
    workspaceId?: string | null;
    userProfile?: string | null;
    isPlatformAdmin?: boolean;
};

/** O que a autenticação sabe de quem chamou, além do id (spec 0021). */
export type UserAccess = {
    workspaceId: string | null;
    userProfile: string | null;
    isPlatformAdmin: boolean;
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
    setUser(userId: string, access: UserAccess): void {
        const store = this.storage.getStore();

        if (!store) return;

        store.userId = userId;
        store.workspaceId = access.workspaceId;
        store.userProfile = access.userProfile;
        store.isPlatformAdmin = access.isPlatformAdmin;
    }

    /**
     * O espaço da requisição, para filtrar e gravar registros de domínio (ADR-0003
     * local). Ausente é erro de fiação, não do cliente: a rota de domínio chegou
     * aqui sem passar por `requireProfile`, que barra quem não tem espaço
     * (ERR-0021-13).
     */
    requireWorkspaceId(): string {
        const workspaceId = this.storage.getStore()?.workspaceId;

        if (!workspaceId) {
            throw CustomError.internal(
                'domain route reached without a workspace in the request context',
                'WORKSPACE_CONTEXT_MISSING',
            );
        }

        return workspaceId;
    }
}
