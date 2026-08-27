import 'reflect-metadata';
import type { Express } from 'express';
import { container as rootContainer } from 'tsyringe';
import { ScopeTypes } from '@bhs-dev/typescript-common-types';

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
});
