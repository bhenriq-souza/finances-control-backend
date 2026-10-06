import 'reflect-metadata';
import type { DataSource } from 'typeorm';

import type { DomainEventDispatcher, TransactionRunner } from '../../../../src/platform';
import { RequestContext } from '../../../../src/platform/context/request-context';
import { InProcessDomainEventDispatcher } from '../../../../src/platform/events/in-process-domain-event-dispatcher';
import { DataSourceTransactionRunner } from '../../../../src/platform/events/transaction-runner';
import { createIsolatedDataSource, dropIsolatedDataSource } from '../../database.helper';

const SCHEMA = 'test_platform_transaction_runner';

const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
};

describe('TransactionRunner (banco real)', () => {
    let dataSource: DataSource;
    let dispatcher: DomainEventDispatcher;
    let runner: TransactionRunner;

    beforeAll(async () => {
        dataSource = await createIsolatedDataSource(SCHEMA);
        await dataSource.query('CREATE TABLE runner_probe (id text PRIMARY KEY)');
    });

    afterAll(async () => {
        await dropIsolatedDataSource(dataSource, SCHEMA);
    });

    beforeEach(async () => {
        await dataSource.query('DELETE FROM runner_probe');
        dispatcher = new InProcessDomainEventDispatcher(logger as never);
        runner = new DataSourceTransactionRunner(dispatcher, dataSource, new RequestContext());
    });

    const exists = async (id: string): Promise<boolean> =>
        ((await dataSource.query('SELECT 1 FROM runner_probe WHERE id = $1', [id])) as unknown[])
            .length > 0;

    it('AC-0004-05, INV-0004-01: handler roda depois do commit e já enxerga a linha', async () => {
        let seenByHandler: boolean | undefined;
        dispatcher.subscribe('RowSaved', async () => {
            seenByHandler = await exists('a');
        });

        await runner.run(async (scope) => {
            await scope.manager.query('INSERT INTO runner_probe (id) VALUES ($1)', ['a']);
            scope.publish({ name: 'RowSaved', payload: { id: 'a' } });
        });

        expect(seenByHandler).toBe(true);
    });

    it('AC-0004-06, INV-0004-02: rollback não deixa linha, não chama handler e propaga o mesmo erro', async () => {
        const handler = jest.fn();
        const failure = new Error('boom');
        dispatcher.subscribe('RowSaved', handler);

        await expect(
            runner.run(async (scope) => {
                await scope.manager.query('INSERT INTO runner_probe (id) VALUES ($1)', ['b']);
                scope.publish({ name: 'RowSaved', payload: { id: 'b' } });
                throw failure;
            }),
        ).rejects.toBe(failure);

        expect(await exists('b')).toBe(false);
        expect(handler).not.toHaveBeenCalled();
    });

    it('AC-0004-09: handler com run próprio despacha o 2º evento após o seu commit, antes de o run externo resolver', async () => {
        const order: string[] = [];
        let innerSawRow: boolean | undefined;

        dispatcher.subscribe('Outer', async () => {
            await runner.run(async (scope) => {
                await scope.manager.query('INSERT INTO runner_probe (id) VALUES ($1)', ['inner']);
                scope.publish({ name: 'Inner', payload: {} });
            });
            order.push('outer-handler-done');
        });
        dispatcher.subscribe('Inner', async () => {
            innerSawRow = await exists('inner');
            order.push('inner-handler');
        });

        await runner.run((scope) => {
            scope.publish({ name: 'Outer', payload: {} });
            return Promise.resolve();
        });
        order.push('outer-run-resolved');

        expect(innerSawRow).toBe(true);
        expect(order).toEqual(['inner-handler', 'outer-handler-done', 'outer-run-resolved']);
    });
});
