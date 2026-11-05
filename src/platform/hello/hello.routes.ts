import type { NextFunction, Request, Response, Router } from 'express';
import { ZodError } from 'zod';
import { inject, injectable } from 'tsyringe';
import type { RouteDef } from '@bhs-dev/typescript-common-types';

import { BaseRoute } from '../http/base.route';
import { HelloControllerSymbol } from '../symbols';
import type { HelloController } from './hello.controller';

@injectable()
export class HelloRoutes extends BaseRoute {
    constructor(@inject(HelloControllerSymbol) private readonly controller: HelloController) {
        super();
    }

    routes(): RouteDef[] {
        return [
            {
                method: 'GET',
                path: '/',
                handler: this.bind(this.controller, this.controller.handleGetHello),
            },
            {
                method: 'GET',
                path: '/:name',
                handler: this.bind(this.controller, this.controller.handleGetHelloName),
            },
            {
                method: 'GET',
                path: '/:name/upper',
                handler: this.bind(this.controller, this.controller.handleGetHelloUpper),
            },
        ];
    }

    /**
     * O Express decodifica `:name` ao casar a rota e lança `URIError` se o
     * percent-encoding for malformado; aqui vira o mesmo ZodError da validação,
     * sem repassar o texto do decodificador (ERR-0023-03).
     */
    override getRouter(): Router {
        const router = super.getRouter();
        router.use((err: unknown, _req: Request, _res: Response, next: NextFunction) => {
            if (err instanceof URIError) {
                return next(
                    new ZodError([
                        {
                            code: 'custom',
                            path: ['name'],
                            message: 'Invalid name',
                        },
                    ]),
                );
            }
            return next(err);
        });
        return router;
    }
}
