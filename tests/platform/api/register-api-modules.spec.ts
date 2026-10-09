import 'reflect-metadata';
import type { Express } from 'express';
import { container as rootContainer } from 'tsyringe';
import { ScopeTypes } from '@bhs-dev/typescript-common-types';

import { DomainEventDispatcherSymbol, JobQueueSymbol } from '../../../src/platform/symbols';
import { registerApiModules, type ApiModule } from '../../../src/platform/api/register-api-modules';

class FakeRoutes {
    getRouter() {
        return 'router' as unknown;
    }
}

class FakeService {}

describe('registerApiModules', () => {
    const buildApp = () => ({ use: jest.fn() }) as unknown as Express;

    let container: typeof rootContainer;

    beforeEach(() => {
        container = rootContainer.createChildContainer();
    });

    const moduleWith = (overrides: Partial<ApiModule> = {}): ApiModule => ({
        path: '/fake',
        route: { token: Symbol.for('FakeRoutes'), clazz: FakeRoutes },
        ...overrides,
    });

    it('publica o router do módulo no caminho declarado', () => {
        const app = buildApp();

        registerApiModules(app, [moduleWith()], process.env, container);

        expect(app.use).toHaveBeenCalledWith('/fake', 'router');
    });

    it('registra providers singleton e transient', () => {
        const app = buildApp();
        const singletonToken = Symbol.for('SingletonService');
        const transientToken = Symbol.for('TransientService');

        registerApiModules(
            app,
            [
                moduleWith({
                    provides: [
                        { token: singletonToken, clazz: FakeService, scope: ScopeTypes.SINGLETON },
                        { token: transientToken, clazz: FakeService, scope: ScopeTypes.TRANSIENT },
                    ],
                }),
            ],
            process.env,
            container,
        );

        expect(container.resolve(singletonToken)).toBe(container.resolve(singletonToken));
        expect(container.resolve(transientToken)).not.toBe(container.resolve(transientToken));
    });

    it('pula o módulo quando enableIf reprova', () => {
        const app = buildApp();

        registerApiModules(app, [moduleWith({ enableIf: () => false })], process.env, container);

        expect(app.use).not.toHaveBeenCalled();
    });

    it('registra o módulo quando enableIf aprova', () => {
        const app = buildApp();

        registerApiModules(
            app,
            [moduleWith({ enableIf: (env) => env.FEATURE === 'on' })],
            { FEATURE: 'on' } as NodeJS.ProcessEnv,
            container,
        );

        expect(app.use).toHaveBeenCalled();
    });

    it('rejeita escopo desconhecido', () => {
        const app = buildApp();

        expect(() =>
            registerApiModules(
                app,
                [
                    moduleWith({
                        provides: [
                            {
                                token: Symbol.for('Bad'),
                                clazz: FakeService,
                                scope: 'weekly' as ScopeTypes,
                            },
                        ],
                    }),
                ],
                process.env,
                container,
            ),
        ).toThrow();
    });

    describe('subscribers', () => {
        it('chama subscribe(dispatcher) uma vez, antes de publicar o router', () => {
            const app = buildApp();
            const dispatcher = { subscribe: jest.fn(), dispatch: jest.fn() };
            container.registerInstance(DomainEventDispatcherSymbol, dispatcher);
            const calls: string[] = [];
            const subscribe = jest.fn(() => calls.push('subscribe'));
            (app.use as jest.Mock).mockImplementation(() => calls.push('use'));
            class FakeSubscriber {
                subscribe = subscribe;
            }
            const token = Symbol.for('FakeSubscriber');

            registerApiModules(
                app,
                [moduleWith({ subscribers: [{ token, clazz: FakeSubscriber }] })],
                process.env,
                container,
            );

            expect(subscribe).toHaveBeenCalledTimes(1);
            expect(subscribe).toHaveBeenCalledWith(dispatcher);
            expect(calls).toEqual(['subscribe', 'use']);
            expect(container.resolve(token)).toBe(container.resolve(token));
        });

        it('módulo sem subscribers não resolve o dispatcher', () => {
            const app = buildApp();

            registerApiModules(app, [moduleWith()], process.env, container);

            expect(app.use).toHaveBeenCalledWith('/fake', 'router');
            expect(container.isRegistered(DomainEventDispatcherSymbol)).toBe(false);
        });
    });

    describe('jobs e módulo sem rotas (spec 0017)', () => {
        const queue = { register: jest.fn(), schedule: jest.fn(), enqueue: jest.fn() };
        const jobsToken = Symbol.for('FakeJobs');
        const register = jest.fn();

        class FakeJobs {
            register = register;
        }

        beforeEach(() => {
            queue.register.mockClear();
            register.mockClear();
            container.registerInstance(JobQueueSymbol, queue);
        });

        it('chama register(queue) uma vez por registrar quando JOBS_ENABLED não é false', () => {
            const app = buildApp();

            registerApiModules(
                app,
                [moduleWith({ jobs: [{ token: jobsToken, clazz: FakeJobs }] })],
                {} as NodeJS.ProcessEnv,
                container,
            );

            expect(register).toHaveBeenCalledTimes(1);
            expect(register).toHaveBeenCalledWith(queue);
        });

        it('com JOBS_ENABLED=false não registra nem resolve a fila', () => {
            const app = buildApp();
            const empty = rootContainer.createChildContainer();

            registerApiModules(
                app,
                [moduleWith({ jobs: [{ token: jobsToken, clazz: FakeJobs }] })],
                { JOBS_ENABLED: 'false' } as NodeJS.ProcessEnv,
                empty,
            );

            expect(register).not.toHaveBeenCalled();
            expect(empty.isRegistered(jobsToken)).toBe(false);
        });

        it('módulo sem path e sem route registra providers e jobs e não publica router', () => {
            const app = buildApp();
            const token = Symbol.for('RoutelessService');

            registerApiModules(
                app,
                [
                    {
                        provides: [{ token, clazz: FakeService, scope: ScopeTypes.SINGLETON }],
                        jobs: [{ token: jobsToken, clazz: FakeJobs }],
                    },
                ],
                {} as NodeJS.ProcessEnv,
                container,
            );

            expect(app.use).not.toHaveBeenCalled();
            expect(container.resolve(token)).toBeInstanceOf(FakeService);
            expect(register).toHaveBeenCalledTimes(1);
        });

        it('path sem route, ou route sem path, é erro de configuração na partida', () => {
            const app = buildApp();
            const route = { token: Symbol.for('FakeRoutes'), clazz: FakeRoutes };

            expect(() =>
                registerApiModules(app, [{ path: '/fake' } as ApiModule], process.env, container),
            ).toThrow(/path.*route/);
            expect(() =>
                registerApiModules(app, [{ route } as ApiModule], process.env, container),
            ).toThrow(/path.*route/);
            expect(app.use).not.toHaveBeenCalled();
        });
    });
});
