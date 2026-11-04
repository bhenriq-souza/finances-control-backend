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
        ];
    }
}
