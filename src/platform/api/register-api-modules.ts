import type { Express } from 'express';
import { container as rootContainer, type InjectionToken } from 'tsyringe';
import { ScopeTypes, type IBaseRoute } from '@bhs-dev/typescript-common-types';
import { CustomError } from '@bhs-dev/typescript-common-errors';

export type ApiProvider = {
    token: InjectionToken;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clazz: new (...args: any[]) => unknown;
    scope: ScopeTypes;
};

export type ApiModule = {
    path: string;
    route: Omit<ApiProvider, 'scope'>;
    provides?: ApiProvider[];
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

        container.registerSingleton(module.route.token, module.route.clazz);
        const routeModule = container.resolve<IBaseRoute>(module.route.token);
        app.use(module.path, routeModule.getRouter());
    }
}
