import 'reflect-metadata';

import { RequestContext } from '../../../src/platform/context/request-context';

describe('RequestContext', () => {
    const context = new RequestContext();
    const store = { correlationId: 'correlation-1', startedAt: 1 };

    it('devolve o correlation-id de dentro da requisição', () => {
        context.run(store, () => {
            expect(context.getCorrelationId()).toBe('correlation-1');
        });
    });

    it('não vaza contexto para fora da requisição', () => {
        context.run(store, () => undefined);

        expect(context.get()).toBeUndefined();
        expect(context.getCorrelationId()).toBeUndefined();
    });

    it('guarda o usuário autenticado (spec 0010)', () => {
        context.run({ ...store }, () => {
            context.setUser('user-id', 'ADMIN');

            expect(context.get()).toMatchObject({ userId: 'user-id', userProfile: 'ADMIN' });
        });
    });

    it('aceita usuário sem perfil', () => {
        context.run({ ...store }, () => {
            context.setUser('user-id', null);

            expect(context.get()?.userProfile).toBeNull();
        });
    });

    it('ignora em silêncio fora da requisição, em vez de estourar', () => {
        expect(() => context.setUser('user-id', 'ADMIN')).not.toThrow();
        expect(context.get()).toBeUndefined();
    });
});
