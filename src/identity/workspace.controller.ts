import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';

import { HttpResponses } from '../platform';
import { WorkspaceServiceSymbol } from './identity.symbols';
import { renameWorkspaceBodySchema, userIdParamsSchema } from './user.schemas';
import type { WorkspaceService, WorkspaceView } from './workspace.service';

/** `workspaceId` aparece só aqui, nas rotas de espaço e de usuário (INV-0021-10). */
export type WorkspaceResponse = {
    id: string;
    name: string;
    memberCount: number;
    createdAt: string;
};

const toResponse = (view: WorkspaceView): WorkspaceResponse => ({
    id: view.id,
    name: view.name,
    memberCount: view.memberCount,
    createdAt: view.createdAt.toISOString(),
});

@injectable()
export class WorkspaceController {
    constructor(@inject(WorkspaceServiceSymbol) private readonly service: WorkspaceService) {}

    async handleList(_req: Request, res: Response): Promise<Response> {
        const workspaces = await this.service.list();

        return HttpResponses.ok(res, workspaces.map(toResponse));
    }

    async handleRename(req: Request, res: Response): Promise<Response> {
        const { id } = userIdParamsSchema.parse(req.params);
        const { name } = renameWorkspaceBodySchema.parse(req.body);

        return HttpResponses.ok(res, toResponse(await this.service.rename(id, name)));
    }
}
