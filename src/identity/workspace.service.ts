import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import type { DataSource } from 'typeorm';

import { DatabaseConnectionSymbol } from '../platform';
import { Workspace } from './workspace.entity';

/** O espaço como a rota o devolve, com a contagem de membros. */
export type WorkspaceView = {
    id: string;
    name: string;
    memberCount: number;
    createdAt: Date;
};

/** Espaços: listagem para a escolha na aprovação e renomeação (spec 0021). */
@injectable()
export class WorkspaceService {
    constructor(@inject(DatabaseConnectionSymbol) private readonly dataSource: DataSource) {}

    async list(): Promise<WorkspaceView[]> {
        const rows = await this.query().orderBy('w.name', 'ASC').addOrderBy('w.id', 'ASC');

        return (await rows.getRawMany<RawWorkspace>()).map(toView);
    }

    async rename(id: string, name: string): Promise<WorkspaceView> {
        const result = await this.dataSource.getRepository(Workspace).update({ id }, { name });

        if (result.affected === 0) throw workspaceNotFound();

        const row = await this.query().where('w.id = :id', { id }).getRawOne<RawWorkspace>();

        if (!row) throw workspaceNotFound();

        return toView(row);
    }

    private query() {
        return this.dataSource
            .createQueryBuilder()
            .select('w.id', 'id')
            .addSelect('w.name', 'name')
            .addSelect('w.created_at', 'created_at')
            .addSelect(
                '(SELECT count(*) FROM workspace_members m WHERE m.workspace_id = w.id)::int',
                'member_count',
            )
            .from(Workspace, 'w');
    }
}

type RawWorkspace = { id: string; name: string; created_at: Date; member_count: number };

const toView = (row: RawWorkspace): WorkspaceView => ({
    id: row.id,
    name: row.name,
    memberCount: Number(row.member_count),
    createdAt: row.created_at,
});

export const workspaceNotFound = (): CustomError =>
    CustomError.notFound('Workspace not found', 'WORKSPACE_NOT_FOUND', { exposeMessage: true });
