import { Router, type RequestHandler } from 'express';
import type { IBaseRoute, RouteDef } from '@bhs-dev/typescript-common-types';

/**
 * Base para os módulos de rota. Cada módulo declara suas rotas de forma
 * declarativa e recebe de graça o encaminhamento de rejeições ao error handler
 * — sem isso, um `async` que rejeita derruba a requisição sem resposta.
 */
export abstract class BaseRoute implements IBaseRoute {
    protected readonly router: Router = Router();

    abstract routes(): RouteDef[];

    /** Encaminha rejeições de handlers async para o `next`, e daí ao error handler. */
    protected wrapAsync(handler: RequestHandler): RequestHandler {
        return (req, res, next) => {
            Promise.resolve(handler(req, res, next)).catch(next);
        };
    }

    protected bind<T extends object>(context: T, handler: RequestHandler): RequestHandler {
        return this.wrapAsync(handler.bind(context));
    }

    getRouter(): Router {
        for (const route of this.routes()) {
            const method = route.method.toLowerCase() as
                'get' | 'post' | 'put' | 'patch' | 'delete';
            this.router[method](route.path, ...(route.middlewares ?? []), route.handler);
        }
        return this.router;
    }
}
