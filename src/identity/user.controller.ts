import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';

import { HttpResponses, RequestContext, RequestContextSymbol } from '../platform';
import { UserServiceSymbol } from './identity.symbols';
import type { User } from './user.entity';
import { toUserResponse, type UserResponse } from './user.response';
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

        return HttpResponses.ok(res, await this.respond(user));
    }

    async handleListUsers(_req: Request, res: Response): Promise<Response> {
        const users = await this.service.list();
        const avatars = await this.service.avatarUpdatedAt(users.map((user) => user.id));

        return HttpResponses.ok(
            res,
            users.map((user) => toUserResponse(user, avatars.get(user.id) ?? null)),
        );
    }

    async handleGrantProfile(req: Request, res: Response): Promise<Response> {
        const { id } = userIdParamsSchema.parse(req.params);
        const { profile } = grantProfileBodySchema.parse(req.body);

        const user = await this.service.grantProfile({
            targetId: id,
            profile,
            actorId: this.actorId(),
            actorWorkspaceId: this.requestContext.requireWorkspaceId(),
        });

        return HttpResponses.ok(res, await this.respond(user));
    }

    async handleRevokeProfile(req: Request, res: Response): Promise<Response> {
        const { id } = userIdParamsSchema.parse(req.params);

        const user = await this.service.revokeProfile({ targetId: id, actorId: this.actorId() });

        return HttpResponses.ok(res, await this.respond(user));
    }

    /**
     * Só a própria foto: nenhuma rota recebe o id de outro usuário (INV-0010-13).
     * O corpo é a imagem crua, lida por `parseAvatarBody`; sem corpo, chega vazio
     * e cai na recusa por tipo.
     */
    async handlePutAvatar(req: Request, res: Response): Promise<Response> {
        const user = await this.service.saveAvatar({
            userId: this.actorId(),
            contentType: req.header('content-type'),
            content: rawBody(req.body),
        });

        return HttpResponses.ok(res, await this.respond(user));
    }

    async handleDeleteAvatar(_req: Request, res: Response): Promise<Response> {
        await this.service.removeAvatar(this.actorId());

        return HttpResponses.noContent(res);
    }

    /**
     * Os bytes com o tipo gravado. `nosniff` impede o navegador de reinterpretar
     * a imagem como outra coisa; o cache é privado porque a rota exige token, e o
     * frontend acrescenta `?v=<avatarUpdatedAt>` para não ler uma foto velha.
     */
    async handleGetAvatar(_req: Request, res: Response): Promise<Response> {
        const avatar = await this.service.findAvatar(this.actorId());

        return res
            .status(200)
            .set({
                'Content-Type': avatar.contentType,
                'Content-Length': String(avatar.content.length),
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'private, max-age=86400',
            })
            .send(avatar.content);
    }

    private async respond(user: User): Promise<UserResponse> {
        const avatars = await this.service.avatarUpdatedAt([user.id]);

        return toUserResponse(user, avatars.get(user.id) ?? null);
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

/**
 * O corpo cru como `Buffer`. As checagens de string e de array vêm antes de
 * `Buffer.isBuffer` para deixar explícito que um corpo de outro tipo nunca chega
 * à validação (CodeQL `js/type-confusion-through-parameter-tampering`).
 */
function rawBody(body: unknown): Buffer {
    if (typeof body === 'string' || Array.isArray(body) || !Buffer.isBuffer(body)) {
        return Buffer.alloc(0);
    }

    return body;
}
