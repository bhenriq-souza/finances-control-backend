import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';

import { HttpResponses, RequestContext, RequestContextSymbol } from '../platform';
import { UserServiceSymbol } from './identity.symbols';
import { toUserResponse } from './user.response';
import { grantProfileBodySchema, userIdParamsSchema } from './user.schemas';
import type { UserService } from './user.service';

@injectable()
export class UserController {
    constructor(
        @inject(UserServiceSymbol) private readonly service: UserService,
        @inject(RequestContextSymbol) private readonly requestContext: RequestContext,
    ) {}

    /** Única rota que responde a quem ainda não tem perfil (INV-0010-03). */
    async handleGetMe(_req: Request, res: Response): Promise<Response> {
        const user = await this.service.findById(this.actorId());

        return HttpResponses.ok(res, toUserResponse(user));
    }

    async handleListUsers(_req: Request, res: Response): Promise<Response> {
        const users = await this.service.list();

        return HttpResponses.ok(res, users.map(toUserResponse));
    }

    async handleGrantProfile(req: Request, res: Response): Promise<Response> {
        const { id } = userIdParamsSchema.parse(req.params);
        const { profile } = grantProfileBodySchema.parse(req.body);

        const user = await this.service.grantProfile({
            targetId: id,
            profile,
            actorId: this.actorId(),
        });

        return HttpResponses.ok(res, toUserResponse(user));
    }

    async handleRevokeProfile(req: Request, res: Response): Promise<Response> {
        const { id } = userIdParamsSchema.parse(req.params);

        const user = await this.service.revokeProfile({ targetId: id, actorId: this.actorId() });

        return HttpResponses.ok(res, toUserResponse(user));
    }

    /**
     * Quem chamou. Ausente aqui significa rota montada sem autenticação — erro de
     * fiação, e não do cliente, do mesmo jeito que na guarda de perfil.
     */
    private actorId(): string {
        const userId = this.requestContext.get()?.userId;

        if (!userId) {
            throw CustomError.internal(
                'user route reached without authentication',
                'ROUTE_WITHOUT_AUTHENTICATION',
            );
        }

        return userId;
    }
}
