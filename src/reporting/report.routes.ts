import type { RequestHandler } from 'express';
import { inject, injectable } from 'tsyringe';
import type { RouteDef } from '@bhs-dev/typescript-common-types';

import {
    BaseRoute,
    RequireAuthenticationSymbol,
    RequireProfileSymbol,
    USER_PROFILES,
    type RequireProfile,
} from '../platform';
import type { ReportController } from './report.controller';
import { ReportControllerSymbol } from './reporting.symbols';

@injectable()
export class ReportRoutes extends BaseRoute {
    constructor(
        @inject(ReportControllerSymbol) private readonly controller: ReportController,
        @inject(RequireAuthenticationSymbol) private readonly requireAuthentication: RequestHandler,
        @inject(RequireProfileSymbol) private readonly requireProfile: RequireProfile,
    ) {
        super();
    }

    routes(): RouteDef[] {
        // Ler relatório é ler: qualquer perfil com acesso, como as listagens (spec 0015).
        const read = [this.requireAuthentication, this.requireProfile(...USER_PROFILES)];

        return [
            {
                method: 'GET',
                path: '/balance',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleBalance),
            },
            {
                method: 'GET',
                path: '/expenses-by-type',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleExpensesByType),
            },
            {
                method: 'GET',
                path: '/earnings-by-type',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleEarningsByType),
            },
        ];
    }
}
