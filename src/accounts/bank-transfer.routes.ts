import type { RequestHandler } from 'express';
import { inject, injectable } from 'tsyringe';
import type { RouteDef } from '@bhs-dev/typescript-common-types';

import {
    BaseRoute,
    RequireAuthenticationSymbol,
    RequireProfileSymbol,
    type RequireProfile,
} from '../platform';
import { BankTransferControllerSymbol } from './accounts.symbols';
import type { BankTransferController } from './bank-transfer.controller';

@injectable()
export class BankTransferRoutes extends BaseRoute {
    constructor(
        @inject(BankTransferControllerSymbol) private readonly controller: BankTransferController,
        @inject(RequireAuthenticationSymbol) private readonly requireAuthentication: RequestHandler,
        @inject(RequireProfileSymbol) private readonly requireProfile: RequireProfile,
    ) {
        super();
    }

    routes(): RouteDef[] {
        // Transferir é movimentar, não cadastrar conta: perfil de quem lança despesas.
        const write = [this.requireAuthentication, this.requireProfile('ADMIN', 'BILLER')];

        return [
            {
                method: 'POST',
                path: '/',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleCreateBankTransfer),
            },
            {
                method: 'PATCH',
                path: '/:id/status',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleChangeBankTransferStatus),
            },
        ];
    }
}
