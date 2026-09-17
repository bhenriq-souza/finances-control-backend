import { DataSource } from 'typeorm';

import {
    AppDataSource,
    buildDataSourceOptions,
    initializeDataSource,
} from '../../../src/platform/database/data-source';
import { SnakeCaseNamingStrategy } from '../../../src/platform/database/snake-case.naming-strategy';

const baseEnv = { DATABASE_URL: 'postgres://user@localhost:5432/finances_test' };

describe('buildDataSourceOptions', () => {
    it('exige DATABASE_URL', () => {
        expect(() => buildDataSourceOptions({})).toThrow(TypeError);
    });

    it('nunca sincroniza schema nem roda migration sozinho', () => {
        const options = buildDataSourceOptions(baseEnv);

        expect(options.synchronize).toBe(false);
        expect(options.migrationsRun).toBe(false);
    });

    it('usa a estratégia de nomes do repositório', () => {
        expect(buildDataSourceOptions(baseEnv).namingStrategy).toBeInstanceOf(
            SnakeCaseNamingStrategy,
        );
    });

    it('aplica os defaults de SSL e de pool', () => {
        const options = buildDataSourceOptions(baseEnv);

        expect(options).toMatchObject({ type: 'postgres', ssl: false, poolSize: 10 });
    });

    it.each([
        ['true', true],
        ['TRUE', true],
        ['false', false],
        ['', false],
    ])('lê DATABASE_SSL=%p como %p', (value, expected) => {
        expect(buildDataSourceOptions({ ...baseEnv, DATABASE_SSL: value }).ssl).toBe(expected);
    });

    it('lê DATABASE_POOL_MAX', () => {
        expect(buildDataSourceOptions({ ...baseEnv, DATABASE_POOL_MAX: '25' }).poolSize).toBe(25);
    });

    it.each(['0', '-1', '2.5', 'dez'])('recusa DATABASE_POOL_MAX=%p', (value) => {
        expect(() => buildDataSourceOptions({ ...baseEnv, DATABASE_POOL_MAX: value })).toThrow(
            TypeError,
        );
    });
});

describe('AppDataSource', () => {
    it('é a conexão única do processo', () => {
        expect(AppDataSource).toBeInstanceOf(DataSource);
        expect(AppDataSource.options.type).toBe('postgres');
    });
});

describe('initializeDataSource', () => {
    it('conecta quando ainda não há conexão', async () => {
        const initialize = jest.fn().mockResolvedValue(undefined);
        const stub = { isInitialized: false, initialize } as unknown as DataSource;

        await initializeDataSource(stub);

        expect(initialize).toHaveBeenCalledTimes(1);
    });

    it('não reconecta quando já está inicializado', async () => {
        const initialize = jest.fn().mockResolvedValue(undefined);
        const stub = { isInitialized: true, initialize } as unknown as DataSource;

        const result = await initializeDataSource(stub);

        expect(initialize).not.toHaveBeenCalled();
        expect(result).toBe(stub);
    });
});
