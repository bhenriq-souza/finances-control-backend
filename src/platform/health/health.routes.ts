import { inject, injectable } from 'tsyringe';
import type { RouteDef } from '@bhs-dev/typescript-common-types';

import { BaseRoute } from '../http/base.route';
import { HealthControllerSymbol } from '../symbols';
import type { HealthController } from './health.controller';

@injectable()
export class HealthRoutes extends BaseRoute {
    constructor(@inject(HealthControllerSymbol) private readonly controller: HealthController) {
        super();
    }

    routes(): RouteDef[] {
        return [
            {
                method: 'GET',
                path: '/',
                handler: this.bind(this.controller, this.controller.handleGetHealth),
            },
        ];
    }
}
