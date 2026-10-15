import 'reflect-metadata';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { CustomError } from '@bhs-dev/typescript-common-errors';

import { RequestContext } from '../../src/platform/context/request-context';
import {
    createRequireMemberOrPlatformAdmin,
    createRequirePlatformAdmin,
    createRequireProfile,
} from '../../src/identity/profile.guard';
import type { UserProfile } from '../../src/identity/user-profile';

type Store = {
    userId?: string;
    workspaceId?: string | null;
    userProfile?: string | null;
    isPlatformAdmin?: boolean;
};

type GuardFactory = (requestContext: RequestContext) => RequestHandler;

/**
 * Executa a guarda dentro de um contexto de requisição já autenticado (ou não).
 * Sem `workspaceId` explícito, o usuário é membro de um espaço (spec 0021).
 */
const runGuard = (store: Store, factory: GuardFactory): Promise<unknown> => {
    const requestContext = new RequestContext();
    const guard = factory(requestContext);

    return new Promise((resolve) => {
        requestContext.run(
            { correlationId: 'c', startedAt: Date.now(), workspaceId: 'w', ...store },
            () => {
                const next: NextFunction = (error?: unknown) => resolve(error);
                guard({} as Request, {} as Response, next);
            },
        );
    });
};

const run = (store: Store, allowed: UserProfile[]): Promise<unknown> =>
    runGuard(store, (context) => createRequireProfile(context)(...allowed));

describe('requireProfile', () => {
    describe('conta sem perfil (ERR-0010-04)', () => {
        it.each([[null], [undefined]])(
            'responde 403 PROFILE_PENDING quando o perfil é %p',
            async (profile) => {
                const error = await run({ userId: 'u', userProfile: profile }, ['ADMIN']);

                expect(error).toBeInstanceOf(CustomError);
                expect(error).toMatchObject({ status: 403, code: 'PROFILE_PENDING' });
            },
        );

        it('a mensagem explica a espera, em vez de dizer só "negado"', async () => {
            const error = await run({ userId: 'u', userProfile: null }, ['ADMIN']);

            expect((error as CustomError).exposeMessage).toBe(true);
            expect((error as CustomError).message).toMatch(/administrator must grant/i);
        });

        it('sem espaço é pendente, mesmo com perfil no contexto (ERR-0021-03)', async () => {
            const error = await run(
                { userId: 'u', workspaceId: null, userProfile: 'ADMIN', isPlatformAdmin: true },
                ['ADMIN'],
            );

            expect(error).toMatchObject({ status: 403, code: 'PROFILE_PENDING' });
        });

        it('valor fora do enum é tratado como ausência de perfil', async () => {
            const error = await run({ userId: 'u', userProfile: 'OWNER' }, ['ADMIN']);

            expect(error).toMatchObject({ status: 403, code: 'PROFILE_PENDING' });
        });
    });

    describe('perfil insuficiente (ERR-0010-05, AC-0010-08)', () => {
        it.each([['BILLER'], ['VIEWER']])('%s não passa em rota de ADMIN', async (profile) => {
            const error = await run({ userId: 'u', userProfile: profile }, ['ADMIN']);

            expect(error).toMatchObject({ status: 403, code: 'FORBIDDEN' });
        });
    });

    describe('perfil suficiente', () => {
        it.each([['ADMIN'], ['BILLER'], ['VIEWER']])(
            '%s passa quando está na lista',
            async (profile) => {
                const error = await run({ userId: 'u', userProfile: profile }, [
                    'ADMIN',
                    'BILLER',
                    'VIEWER',
                ]);

                expect(error).toBeUndefined();
            },
        );

        it('aceita qualquer um dos perfis permitidos', async () => {
            const error = await run({ userId: 'u', userProfile: 'BILLER' }, ['ADMIN', 'BILLER']);

            expect(error).toBeUndefined();
        });
    });

    describe('fiação errada', () => {
        it('sem autenticação antes, é erro de programação e não 401', async () => {
            const error = await run({}, ['ADMIN']);

            expect(error).toMatchObject({
                status: 500,
                code: 'PROFILE_GUARD_WITHOUT_AUTHENTICATION',
            });
        });

        it('fora de um contexto de requisição, idem', async () => {
            const requestContext = new RequestContext();
            const requireProfile = createRequireProfile(requestContext);

            const error = await new Promise((resolve) => {
                requireProfile('ADMIN')(
                    {} as Request,
                    {} as Response,
                    ((e?: unknown) => resolve(e)) as NextFunction,
                );
            });

            expect(error).toMatchObject({ status: 500 });
        });
    });
});

describe('requirePlatformAdmin (spec 0021)', () => {
    const run = (store: Store) =>
        runGuard(store, (context) => createRequirePlatformAdmin(context)());

    it('passa o admin da plataforma, mesmo sem espaço', async () => {
        await expect(
            run({ userId: 'u', workspaceId: null, userProfile: null, isPlatformAdmin: true }),
        ).resolves.toBeUndefined();
    });

    it('recusa com 403 FORBIDDEN o ADMIN de espaço sem a marca (ERR-0021-04)', async () => {
        await expect(
            run({ userId: 'u', userProfile: 'ADMIN', isPlatformAdmin: false }),
        ).resolves.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    });

    it('sem autenticação antes, é erro de fiação', async () => {
        await expect(run({})).resolves.toMatchObject({
            status: 500,
            code: 'PROFILE_GUARD_WITHOUT_AUTHENTICATION',
        });
    });
});

describe('requireMemberOrPlatformAdmin (spec 0021)', () => {
    const run = (store: Store) =>
        runGuard(store, (context) => createRequireMemberOrPlatformAdmin(context)());

    it.each([['ADMIN'], ['BILLER'], ['VIEWER']])('passa o membro %s', async (profile) => {
        await expect(
            run({ userId: 'u', userProfile: profile, isPlatformAdmin: false }),
        ).resolves.toBeUndefined();
    });

    it('passa o admin da plataforma sem espaço', async () => {
        await expect(
            run({ userId: 'u', workspaceId: null, userProfile: null, isPlatformAdmin: true }),
        ).resolves.toBeUndefined();
    });

    it('recusa o pendente com 403 PROFILE_PENDING', async () => {
        await expect(
            run({ userId: 'u', workspaceId: null, userProfile: null, isPlatformAdmin: false }),
        ).resolves.toMatchObject({ status: 403, code: 'PROFILE_PENDING' });
    });

    it('sem autenticação antes, é erro de fiação', async () => {
        await expect(run({})).resolves.toMatchObject({
            status: 500,
            code: 'PROFILE_GUARD_WITHOUT_AUTHENTICATION',
        });
    });
});
