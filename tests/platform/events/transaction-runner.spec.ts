import 'reflect-metadata';
import type { DataSource, EntityManager } from 'typeorm';

import type { DomainEvent, DomainEventDispatcher, TransactionScope } from '../../../src/platform';
import type { RequestContext } from '../../../src/platform/context/request-context';
import { DataSourceTransactionRunner } from '../../../src/platform/events/transaction-runner';

const manager = { tag: 'tx-manager' } as unknown as EntityManager;

/** Dublê: executa o callback e propaga o resultado/erro, como o commit/rollback real. */
function makeDataSource() {
    return {
        transaction: jest.fn((work: (m: EntityManager) => Promise<unknown>) => work(manager)),
    } as unknown as jest.Mocked<DataSource>;
}

function makeDispatcher() {
    return {
        subscribe: jest.fn(),
        dispatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DomainEventDispatcher>;
}

const context = { getCorrelationId: () => 'corr-1' } as unknown as RequestContext;

describe('DataSourceTransactionRunner', () => {
    let dataSource: jest.Mocked<DataSource>;
    let dispatcher: jest.Mocked<DomainEventDispatcher>;
    let runner: DataSourceTransactionRunner;

    beforeEach(() => {
        dataSource = makeDataSource();
        dispatcher = makeDispatcher();
        runner = new DataSourceTransactionRunner(dispatcher, dataSource, context);
    });

    it('INV-0004-01: despacha em ordem só depois do commit e preenche o envelope', async () => {
        const order: string[] = [];
        dataSource.transaction.mockImplementation(async (work: unknown) => {
            const result = await (work as (m: EntityManager) => Promise<unknown>)(manager);
            order.push('commit');
            return result;
        });
        dispatcher.dispatch.mockImplementation(() => {
            order.push('dispatch');
            return Promise.resolve();
        });

        const result = await runner.run((scope) => {
            expect(scope.manager).toBe(manager);
            scope.publish({ name: 'A', payload: { id: '1' } });
            scope.publish({ name: 'B', payload: { id: '2' } });
            return Promise.resolve('ok');
        });

        expect(result).toBe('ok');
        expect(order).toEqual(['commit', 'dispatch']);

        const events = dispatcher.dispatch.mock.calls[0]![0] as readonly DomainEvent[];

        expect(events.map((e) => e.name)).toEqual(['A', 'B']);
        expect(events[0]).toMatchObject({ correlationId: 'corr-1', payload: { id: '1' } });
        expect(events[0]!.occurredAt).toBeInstanceOf(Date);
    });

    it('AC-0004-07: run só resolve depois de o despacho terminar', async () => {
        dispatcher.dispatch.mockImplementation(
            () => new Promise((resolve) => setTimeout(resolve, 50)),
        );
        const started = Date.now();

        await runner.run((scope) => {
            scope.publish({ name: 'A', payload: {} });
            return Promise.resolve();
        });

        expect(Date.now() - started).toBeGreaterThanOrEqual(45);
    });

    it('ERR-0004-02, INV-0004-02: work rejeita, descarta eventos e propaga o mesmo erro', async () => {
        const failure = new Error('boom');

        await expect(
            runner.run((scope) => {
                scope.publish({ name: 'A', payload: {} });
                return Promise.reject(failure);
            }),
        ).rejects.toBe(failure);

        expect(dispatcher.dispatch).not.toHaveBeenCalled();
    });

    it('AC-0004-08, ERR-0004-03: publish após o escopo encerrar lança e nada é acumulado', async () => {
        let kept!: TransactionScope;

        await runner.run((scope) => {
            kept = scope;
            return Promise.resolve();
        });

        expect(() => kept.publish({ name: 'Late', payload: {} })).toThrow(
            new Error('transaction scope is closed'),
        );
        expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
        expect(dispatcher.dispatch).toHaveBeenCalledWith([]);
    });

    it('ERR-0004-03: escopo também fecha quando work rejeita', async () => {
        let kept!: TransactionScope;

        await runner
            .run((scope) => {
                kept = scope;
                return Promise.reject(new Error('x'));
            })
            .catch(() => undefined);

        expect(() => kept.publish({ name: 'Late', payload: {} })).toThrow(
            'transaction scope is closed',
        );
    });
});
