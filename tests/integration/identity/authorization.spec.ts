import request from 'supertest';

import {
    EXPIRED_TOKEN,
    INVALID_TOKEN,
    PROVIDER_DOWN_TOKEN,
    startIdentityApp,
    stopIdentityApp,
    type IdentityTestApp,
} from './identity-app.helper';

const SCHEMA = 'test_identity_authorization';

describe('autorização nas rotas de usuário (spec 0010)', () => {
    let ctx: IdentityTestApp;

    beforeAll(async () => {
        ctx = await startIdentityApp(SCHEMA);
    });

    afterAll(async () => {
        await stopIdentityApp(ctx, SCHEMA);
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM users');
    });

    describe('sem token válido (AC-0010-01, INV-0010-01)', () => {
        it.each([
            ['GET', '/users/me'],
            ['GET', '/users'],
        ])('%s %s sem header responde 401 UNAUTHENTICATED', async (method, path) => {
            const response = await request(ctx.app)[method.toLowerCase() as 'get'](path);

            expect(response.status).toBe(401);
            expect(response.body.error.code).toBe('UNAUTHENTICATED');
        });

        it('token inválido responde 401 UNAUTHENTICATED (ERR-0010-02)', async () => {
            const response = await request(ctx.app)
                .get('/users/me')
                .set('Authorization', `Bearer ${INVALID_TOKEN}`);

            expect(response.status).toBe(401);
            expect(response.body.error.code).toBe('UNAUTHENTICATED');
            // O motivo do provedor não vaza para a resposta.
            expect(JSON.stringify(response.body)).not.toContain('assinatura');
        });

        it('token expirado responde 401 TOKEN_EXPIRED (ERR-0010-03)', async () => {
            const response = await request(ctx.app)
                .get('/users/me')
                .set('Authorization', `Bearer ${EXPIRED_TOKEN}`);

            expect(response.status).toBe(401);
            expect(response.body.error.code).toBe('TOKEN_EXPIRED');
        });

        it('provedor fora do ar responde 503, não 401 (ERR-0010-10)', async () => {
            const response = await request(ctx.app)
                .get('/users/me')
                .set('Authorization', `Bearer ${PROVIDER_DOWN_TOKEN}`);

            expect(response.status).toBe(503);
            expect(response.body.error.code).toBe('AUTH_UNAVAILABLE');
        });

        it('/health continua aberto: é a exceção declarada (INV-0010-01)', async () => {
            await expect(request(ctx.app).get('/health')).resolves.toMatchObject({ status: 200 });
            await expect(request(ctx.app).get('/health/ready')).resolves.toMatchObject({
                status: 200,
            });
        });
    });

    describe('conta sem perfil (INV-0010-03, AC-0010-05)', () => {
        it('enxerga a si mesma em /users/me', async () => {
            const response = await request(ctx.app)
                .get('/users/me')
                .set('Authorization', 'Bearer uid-pendente');

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({
                email: 'uid-pendente@exemplo.com',
                profile: null,
                profileGrantedAt: null,
            });
        });

        it('e não enxerga mais nada', async () => {
            await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-pendente');

            const response = await request(ctx.app)
                .get('/users')
                .set('Authorization', 'Bearer uid-pendente');

            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe('PROFILE_PENDING');
        });

        it('o primeiro acesso já cria o registro local (AC-0010-02)', async () => {
            await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-novo');

            await expect(ctx.findByUid('uid-novo')).resolves.toMatchObject({
                email: 'uid-novo@exemplo.com',
                profile: null,
            });
        });
    });

    describe('perfil insuficiente (AC-0010-08)', () => {
        it.each(['BILLER', 'VIEWER'] as const)('%s não lista usuários', async (profile) => {
            await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-comum');
            await ctx.setProfile('uid-comum', profile);

            const response = await request(ctx.app)
                .get('/users')
                .set('Authorization', 'Bearer uid-comum');

            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe('FORBIDDEN');
        });

        it('ADMIN lista, ordenado por criação', async () => {
            await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-admin');
            await ctx.setProfile('uid-admin', 'ADMIN');
            await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-outro');

            const response = await request(ctx.app)
                .get('/users')
                .set('Authorization', 'Bearer uid-admin');

            expect(response.status).toBe(200);
            expect(response.body.data).toHaveLength(2);
            expect(response.body.data[0].email).toBe('uid-admin@exemplo.com');
            // O UID do Firebase não é assunto da API.
            expect(Object.keys(response.body.data[0])).toEqual([
                'id',
                'email',
                'name',
                'profile',
                'profileGrantedAt',
                'createdAt',
            ]);
        });
    });
});
