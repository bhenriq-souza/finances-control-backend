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

        const read = [this.requireAuthentication, this.requireProfile(...USER_PROFILES)];

        return [
            {
                method: 'GET',
                path: '/',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleListBankTransfers),
            },
            {
                method: 'GET',
                path: '/:id',
                middlewares: read,
                handler: this.bind(this.controller, this.controller.handleGetBankTransfer),
            },
            {
                method: 'PATCH',
                path: '/:id',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleUpdateBankTransfer),
            },
            {
                method: 'DELETE',
                path: '/:id',
                middlewares: write,
                handler: this.bind(this.controller, this.controller.handleDeleteBankTransfer),
            },
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
