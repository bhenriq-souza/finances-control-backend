import request from 'supertest';

import type { TestApp } from '../app.helper';

/** Um lado do cenário de isolamento: o espaço, o membro `ADMIN` dele e um cliente autenticado. */
export type WorkspaceSide = {
    workspaceId: string;
    userId: string;
    /** Header `Authorization` do membro `ADMIN` do espaço. */
    token: string;
    get: (path: string) => request.Test;
    post: (path: string, body?: object) => request.Test;
    patch: (path: string, body?: object) => request.Test;
    put: (path: string, body?: object) => request.Test;
    delete: (path: string) => request.Test;
};

export type TwoWorkspaces = { a: WorkspaceSide; b: WorkspaceSide };

/** Cria um espaço direto no banco, como a aprovação da T-0021-02 fará pela API. */
export async function createWorkspace(ctx: TestApp, name: string): Promise<string> {
    const [row] = (await ctx.dataSource.query(
        'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
        [name],
    )) as [{ id: string }];

    return row.id;
}

/**
 * Um espaço novo com um membro `ADMIN` (`uid`) e o cliente HTTP dele. O usuário
 * nasce pelo primeiro acesso, como em produção, e vira membro direto no banco.
 */
export async function createWorkspaceWithAdmin(
    ctx: TestApp,
    name: string,
    uid: string,
): Promise<WorkspaceSide> {
    const workspaceId = await createWorkspace(ctx, name);
    const token = `Bearer ${uid}`;

    await request(ctx.app).get('/users/me').set('Authorization', token);
    const user = await ctx.setProfile(uid, 'ADMIN', undefined, workspaceId);

    return {
        workspaceId,
        userId: user.id,
        token,
        get: (path) => request(ctx.app).get(path).set('Authorization', token),
        post: (path, body = {}) =>
            request(ctx.app).post(path).set('Authorization', token).send(body),
        patch: (path, body = {}) =>
            request(ctx.app).patch(path).set('Authorization', token).send(body),
        put: (path, body = {}) => request(ctx.app).put(path).set('Authorization', token).send(body),
        delete: (path) => request(ctx.app).delete(path).set('Authorization', token),
    };
}

/**
 * Dois espaços, A e B, cada um com um membro `ADMIN` e o cliente autenticado dele
 * (spec 0021, Acceptance criteria de isolamento). Nenhum dos dois é admin da
 * plataforma: é o caso comum de quem só enxerga o próprio espaço.
 */
export async function createTwoWorkspaces(ctx: TestApp): Promise<TwoWorkspaces> {
    return {
        a: await createWorkspaceWithAdmin(ctx, 'Espaço A', 'uid-admin-a'),
        b: await createWorkspaceWithAdmin(ctx, 'Espaço B', 'uid-admin-b'),
    };
}
