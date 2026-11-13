import { inject, injectable } from 'tsyringe';
import type { RouteDef } from '@bhs-dev/typescript-common-types';

import { BaseRoute } from '../http/base.route';
import { VersionControllerSymbol } from '../symbols';
import type { VersionController } from './version.controller';

@injectable()
export class VersionRoutes extends BaseRoute {
    constructor(@inject(VersionControllerSymbol) private readonly controller: VersionController) {
        super();
    }

    routes(): RouteDef[] {
        return [
            {
                method: 'GET',
                path: '/',
                handler: this.bind(this.controller, this.controller.handleGetVersion),
            },
        ];
    }
}
