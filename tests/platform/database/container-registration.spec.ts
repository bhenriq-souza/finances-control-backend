import type { DataSource } from 'typeorm';

import { container } from '../../../src/container';
import { AppDataSource } from '../../../src/platform/database/data-source';
import { DatabaseConnectionSymbol } from '../../../src/platform/symbols';

describe('registro da conexão no container', () => {
    it('resolve o DataSource único da aplicação (AC-0003-03, INV-0003-01)', () => {
        const first = container.resolve<DataSource>(DatabaseConnectionSymbol);
        const second = container.resolve<DataSource>(DatabaseConnectionSymbol);

        expect(first).toBe(AppDataSource);
        expect(second).toBe(first);
    });
});
