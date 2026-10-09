import type { Express } from 'express';
import { container as rootContainer, type InjectionToken } from 'tsyringe';
import { ScopeTypes, type IBaseRoute } from '@bhs-dev/typescript-common-types';
import { CustomError } from '@bhs-dev/typescript-common-errors';

import type {
    DomainEventDispatcher,
    DomainEventSubscriber,
} from '../events/domain-event-dispatcher';
import type { JobQueue, JobRegistrar } from '../jobs/job-queue';
import { DomainEventDispatcherSymbol, JobQueueSymbol } from '../symbols';

export type ApiProvider = {
    token: InjectionToken;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clazz: new (...args: any[]) => unknown;
    scope: ScopeTypes;
};

/** `path` e `route` vêm sempre juntos: sem eles, o módulo não publica router. */
type ApiModuleRoute = {
    path: string;
    route: Omit<ApiProvider, 'scope'>;
};

type ApiModuleWithoutRoute = { path?: undefined; route?: undefined };

export type ApiModule = (ApiModuleRoute | ApiModuleWithoutRoute) & {
    provides?: ApiProvider[];
    /** Consumidores de eventos de domínio; `subscribe` é chamado uma vez, antes do router. */
    subscribers?: Array<Omit<ApiProvider, 'scope'>>;
    /** `JobRegistrar`s; `register(queue)` é chamado uma vez, só com `JOBS_ENABLED` diferente de `false`. */
    jobs?: Array<Omit<ApiProvider, 'scope'>>;
    enableIf?: (env: NodeJS.ProcessEnv) => boolean;
};

/**
 * Monta os módulos da API a partir de uma lista declarativa: cada módulo
 * registra suas dependências no container e publica seu router num prefixo.
 * Adicionar um contexto novo passa a ser uma entrada em `api.config.ts`.
 */
export function registerApiModules(
    app: Express,
    modules: ApiModule[],
    env: NodeJS.ProcessEnv = process.env,
    container = rootContainer,
): void {
    for (const module of modules) {
        if ((module.path === undefined) !== (module.route === undefined)) {
            throw new Error(
                'ApiModule configuration error: "path" and "route" must be given together',
            );
        }
    }

    for (const module of modules) {
        if (module.enableIf && !module.enableIf(env)) continue;

        for (const provider of module.provides ?? []) {
            switch (provider.scope) {
                case ScopeTypes.TRANSIENT:
                    container.register(provider.token, { useClass: provider.clazz });
                    break;
                case ScopeTypes.SINGLETON:
                    container.registerSingleton(provider.token, provider.clazz);
                    break;
                default:
                    throw CustomError.apiModuleNotRecognized();
            }
        }

        for (const subscriber of module.subscribers ?? []) {
            container.registerSingleton(subscriber.token, subscriber.clazz);
            container
                .resolve<DomainEventSubscriber>(subscriber.token)
                .subscribe(container.resolve<DomainEventDispatcher>(DomainEventDispatcherSymbol));
        }

        if (module.jobs?.length && env.JOBS_ENABLED !== 'false') {
            const queue = container.resolve<JobQueue>(JobQueueSymbol);

            for (const job of module.jobs) {
                container.registerSingleton(job.token, job.clazz);
                container.resolve<JobRegistrar>(job.token).register(queue);
            }
        }

        if (module.path === undefined || module.route === undefined) continue;

        container.registerSingleton(module.route.token, module.route.clazz);
        const routeModule = container.resolve<IBaseRoute>(module.route.token);
        app.use(module.path, routeModule.getRouter());
    }
}
