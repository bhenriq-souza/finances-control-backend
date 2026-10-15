import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_identity_avatar';
const OWNER = 'Bearer uid-dono';
const OTHER = 'Bearer uid-outro';
const PENDING = 'Bearer uid-pendente';
const ADMIN = 'Bearer uid-admin';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff, 0xe0];

/** Assinatura seguida de bytes variados até o tamanho pedido. */
const image = (signature: number[], size: number): Buffer => {
    const bytes = Buffer.alloc(size);

    Buffer.from(signature).copy(bytes);
    for (let i = signature.length; i < size; i += 1) bytes[i] = (i * 31) % 256;

    return bytes;
};

const PNG_10KB = image(PNG_SIGNATURE, 10 * 1024);
const JPEG_20KB = image(JPEG_SIGNATURE, 20 * 1024);

describe('foto do usuário (spec 0010)', () => {
    let ctx: TestApp;

    const put = (auth: string, contentType: string, body: Buffer | string) =>
        request(ctx.app)
            .put('/users/me/avatar')
            .set('Authorization', auth)
            .set('Content-Type', contentType)
            .send(body);

    const getAvatar = (auth: string) =>
        request(ctx.app).get('/users/me/avatar').set('Authorization', auth).responseType('blob');

    const me = (auth: string) => request(ctx.app).get('/users/me').set('Authorization', auth);

    const storedAvatars = () =>
        ctx.dataSource.query<{ user_id: string; content: Buffer; content_type: string }[]>(
            'SELECT user_id, content, content_type FROM user_avatars ORDER BY user_id',
        );

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        for (const auth of [OWNER, OTHER, PENDING, ADMIN]) await me(auth);

        await ctx.setProfile('uid-dono', 'VIEWER');
        await ctx.setProfile('uid-outro', 'BILLER');
        await ctx.setProfile('uid-admin', 'ADMIN');
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        // A FK em cascata leva as fotos junto com os usuários.
        await ctx.dataSource.query('DELETE FROM workspace_members');
        await ctx.dataSource.query('DELETE FROM users');
    });

    describe('tabela user_avatars', () => {
        it('nomeia as constraints pela convenção e mantém updated_at por trigger', async () => {
            const constraints = await ctx.dataSource.query<{ conname: string }[]>(`
                SELECT con.conname
                FROM pg_constraint con
                JOIN pg_class c ON c.oid = con.conrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relname = 'user_avatars' AND n.nspname = current_schema()
                ORDER BY con.conname
            `);
            const triggers = await ctx.dataSource.query<{ tgname: string }[]>(`
                SELECT t.tgname
                FROM pg_trigger t
                JOIN pg_class c ON c.oid = t.tgrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relname = 'user_avatars' AND n.nspname = current_schema()
                  AND NOT t.tgisinternal
            `);

            expect(constraints.map((row) => row.conname)).toEqual([
                'ck_user_avatars_content_type',
                'ck_user_avatars_size_bytes',
                'fk_user_avatars_user_id',
                'pk_user_avatars',
            ]);
            expect(triggers.map((row) => row.tgname)).toEqual(['set_user_avatars_updated_at']);
        });

        it('o banco recusa tipo fora da lista e tamanho fora da faixa', async () => {
            const owner = await ctx.findByUid('uid-dono');
            const insert = (contentType: string, size: number) =>
                ctx.dataSource.query(
                    'INSERT INTO user_avatars (user_id, content, content_type, size_bytes) VALUES ($1, $2, $3, $4)',
                    [owner!.id, Buffer.from([1]), contentType, size],
                );

            await expect(insert('image/svg+xml', 1)).rejects.toThrow(
                /ck_user_avatars_content_type/,
            );
            await expect(insert('image/png', 0)).rejects.toThrow(/ck_user_avatars_size_bytes/);
            await expect(insert('image/png', 524289)).rejects.toThrow(/ck_user_avatars_size_bytes/);
        });
    });

    describe('envio e leitura (AC-0010-19)', () => {
        it('grava um PNG de 10 KB e devolve os mesmos bytes, com os headers da spec', async () => {
            const uploaded = await put(OWNER, 'image/png', PNG_10KB);

            expect(uploaded.status).toBe(200);
            expect(uploaded.body.data.avatarUpdatedAt).toEqual(expect.any(String));

            const avatar = await getAvatar(OWNER);

            expect(avatar.status).toBe(200);
            expect(Buffer.compare(avatar.body as Buffer, PNG_10KB)).toBe(0);
            expect(avatar.headers['content-type']).toBe('image/png');
            expect(avatar.headers['content-length']).toBe(String(PNG_10KB.length));
            expect(avatar.headers['x-content-type-options']).toBe('nosniff');
            expect(avatar.headers['cache-control']).toBe('private, max-age=86400');

            const current = await me(OWNER);

            expect(current.body.data.avatarUpdatedAt).toBe(uploaded.body.data.avatarUpdatedAt);
        });

        it('ignora o ?v= que o frontend acrescenta para furar o cache', async () => {
            await put(OWNER, 'image/png', PNG_10KB);

            const avatar = await request(ctx.app)
                .get('/users/me/avatar?v=2026-10-13T00:00:00.000Z')
                .set('Authorization', OWNER)
                .responseType('blob');

            expect(avatar.status).toBe(200);
        });

        it('aceita exatamente 524288 bytes', async () => {
            const response = await put(OWNER, 'image/png', image(PNG_SIGNATURE, 524288));

            expect(response.status).toBe(200);
        });

        it('sem foto, avatarUpdatedAt é nulo em /users/me e na lista', async () => {
            await put(OWNER, 'image/png', PNG_10KB);

            const current = await me(OTHER);
            const list = await request(ctx.app).get('/users').set('Authorization', ADMIN);
            const byEmail = new Map<string, { avatarUpdatedAt: string | null }>(
                (list.body.data as { email: string; avatarUpdatedAt: string | null }[]).map(
                    (user) => [user.email, user],
                ),
            );

            expect(current.body.data.avatarUpdatedAt).toBeNull();
            expect(byEmail.get('uid-outro@exemplo.com')?.avatarUpdatedAt).toBeNull();
            expect(byEmail.get('uid-dono@exemplo.com')?.avatarUpdatedAt).toEqual(
                expect.any(String),
            );
        });
    });

    describe('troca e remoção (AC-0010-20, ERR-0010-14)', () => {
        it('um segundo envio substitui a foto e muda avatarUpdatedAt', async () => {
            const first = await put(OWNER, 'image/png', PNG_10KB);
            const second = await put(OWNER, 'image/jpeg', JPEG_20KB);

            expect(second.status).toBe(200);
            expect(second.body.data.avatarUpdatedAt).not.toBe(first.body.data.avatarUpdatedAt);

            const rows = await storedAvatars();

            expect(rows).toHaveLength(1);
            expect(rows[0]?.content_type).toBe('image/jpeg');

            const avatar = await getAvatar(OWNER);

            expect(avatar.headers['content-type']).toBe('image/jpeg');
            expect(Buffer.compare(avatar.body as Buffer, JPEG_20KB)).toBe(0);
        });

        it('DELETE remove a foto, zera avatarUpdatedAt e é idempotente', async () => {
            await put(OWNER, 'image/png', PNG_10KB);

            const removed = await request(ctx.app)
                .delete('/users/me/avatar')
                .set('Authorization', OWNER);

            expect(removed.status).toBe(204);
            expect((await me(OWNER)).body.data.avatarUpdatedAt).toBeNull();

            const missing = await getAvatar(OWNER);

            expect(missing.status).toBe(404);
            expect(JSON.parse((missing.body as Buffer).toString()).error.code).toBe(
                'AVATAR_NOT_FOUND',
            );

            const again = await request(ctx.app)
                .delete('/users/me/avatar')
                .set('Authorization', OWNER);

            expect(again.status).toBe(204);
            expect(await storedAvatars()).toEqual([]);
        });
    });

    describe('recusas (AC-0010-21, ERR-0010-12, ERR-0010-13)', () => {
        let before: Awaited<ReturnType<typeof storedAvatars>>;

        beforeEach(async () => {
            await put(OWNER, 'image/png', PNG_10KB);
            before = await storedAvatars();
        });

        it('um corpo de 524289 bytes recebe 413 AVATAR_TOO_LARGE', async () => {
            const response = await put(OWNER, 'image/png', image(PNG_SIGNATURE, 524289));

            expect(response.status).toBe(413);
            expect(response.body.error.code).toBe('AVATAR_TOO_LARGE');
            expect(response.body.error.message).toContain('524288');
            expect(await storedAvatars()).toEqual(before);
        });

        it.each([
            ['image/svg+xml', 'SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
            ['image/png', 'texto como PNG', Buffer.from('isto não é uma imagem')],
            ['image/png', 'JPEG declarado como PNG', JPEG_20KB],
            ['image/gif', 'GIF', Buffer.from('GIF89a')],
            ['application/json', 'JSON', Buffer.from('{"foto":"nao"}')],
            ['application/octet-stream', 'PNG sem tipo de imagem', PNG_10KB],
        ])('%s (%s) recebe 415 AVATAR_UNSUPPORTED_TYPE', async (contentType, _name, body) => {
            const response = await put(OWNER, contentType, body);

            expect(response.status).toBe(415);
            expect(response.body.error.code).toBe('AVATAR_UNSUPPORTED_TYPE');
            expect(response.body.error.message).toContain('image/jpeg, image/png, image/webp');
            expect(await storedAvatars()).toEqual(before);
        });

        it('sem corpo recebe 415', async () => {
            const response = await request(ctx.app)
                .put('/users/me/avatar')
                .set('Authorization', OWNER);

            expect(response.status).toBe(415);
            expect(await storedAvatars()).toEqual(before);
        });
    });

    describe('só a própria foto (INV-0010-13)', () => {
        it('um usuário não lê nem remove a foto de outro', async () => {
            await put(OWNER, 'image/png', PNG_10KB);

            expect((await getAvatar(OTHER)).status).toBe(404);

            await request(ctx.app).delete('/users/me/avatar').set('Authorization', OTHER);

            expect(await storedAvatars()).toHaveLength(1);
            expect((await getAvatar(OWNER)).status).toBe(200);
        });
    });

    describe('autorização (AC-0010-22)', () => {
        const routes = [
            (auth?: string) => {
                const call = request(ctx.app)
                    .put('/users/me/avatar')
                    .set('Content-Type', 'image/png');
                return (auth ? call.set('Authorization', auth) : call).send(PNG_10KB);
            },
            (auth?: string) => {
                const call = request(ctx.app).get('/users/me/avatar');
                return auth ? call.set('Authorization', auth) : call;
            },
            (auth?: string) => {
                const call = request(ctx.app).delete('/users/me/avatar');
                return auth ? call.set('Authorization', auth) : call;
            },
        ];

        it.each([0, 1, 2])('usuário sem perfil recebe 403 PROFILE_PENDING (rota %i)', async (i) => {
            const response = await routes[i]!(PENDING);

            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe('PROFILE_PENDING');
            expect(await storedAvatars()).toEqual([]);
        });

        it.each([0, 1, 2])('sem token recebe 401 UNAUTHENTICATED (rota %i)', async (i) => {
            const response = await routes[i]!();

            expect(response.status).toBe(401);
            expect(response.body.error.code).toBe('UNAUTHENTICATED');
        });

        it.each(['VIEWER', 'BILLER', 'ADMIN'] as const)(
            'o perfil %s envia foto',
            async (profile) => {
                await ctx.setProfile('uid-dono', profile);

                expect((await put(OWNER, 'image/png', PNG_10KB)).status).toBe(200);
            },
        );
    });

    describe('ler o usuário não carrega os bytes (AC-0010-23, INV-0010-14)', () => {
        const queriesDuring = async (run: () => Promise<unknown>): Promise<string[]> => {
            const spy = jest.spyOn(ctx.dataSource.logger, 'logQuery');

            await run();

            const queries = spy.mock.calls.map(([query]) => query);
            spy.mockRestore();

            return queries;
        };

        beforeEach(async () => {
            await put(OWNER, 'image/png', PNG_10KB);
            await put(ADMIN, 'image/jpeg', JPEG_20KB);
        });

        it.each([
            ['GET /users/me', () => me(OWNER)],
            ['GET /users', () => request(ctx.app).get('/users').set('Authorization', ADMIN)],
            [
                'DELETE /users/me/avatar',
                () => request(ctx.app).delete('/users/me/avatar').set('Authorization', OWNER),
            ],
        ])('%s não seleciona user_avatars.content', async (_name, run) => {
            const queries = await queriesDuring(run);

            // Controle: a requisição provisionou o usuário e passou por user_avatars.
            expect(queries.some((query) => query.includes('"users"'))).toBe(true);
            expect(queries.some((query) => query.includes('"user_avatars"'))).toBe(true);
            expect(queries.filter((query) => /"content"/.test(query))).toEqual([]);
        });

        it('GET /users/me/avatar é a leitura que pede os bytes', async () => {
            const queries = await queriesDuring(() => getAvatar(OWNER));

            expect(queries.filter((query) => /"content"/.test(query))).toHaveLength(1);
        });
    });
});
