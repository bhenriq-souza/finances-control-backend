import type { Config } from 'jest';

const config: Config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src', '<rootDir>/tests'],
    testMatch: ['**/?(*.)+(spec|test).ts'],
    setupFiles: ['<rootDir>/tests/setup.ts'],
    // Nenhum teste fala com o Firebase (INV-0010-07). O mapa torna isso
    // impossível por construção, e evita que o Jest precise parsear as
    // dependências publicadas só como ESM que o SDK traz.
    moduleNameMapper: {
        '^firebase-admin/(.*)$': '<rootDir>/tests/mocks/firebase-admin-$1.ts',
    },
    // `pg-boss` e as dependências dele (cron-parser, serialize-error, non-error,
    // is-network-error, rrule-temporal, type-fest, luxon) são só ESM: o Jest em CJS
    // precisa transpilá-las. A lista é exatamente essa; acrescente aqui se uma
    // atualização do `pg-boss` trouxer outra.
    transform: {
        '^.+\\.ts$': 'ts-jest',
        '^.+\\.js$': [
            'ts-jest',
            {
                tsconfig: {
                    allowJs: true,
                    module: 'commonjs',
                    target: 'es2022',
                    esModuleInterop: true,
                },
                diagnostics: false,
            },
        ],
    },
    transformIgnorePatterns: [
        '/node_modules/(?!(pg-boss|cron-parser|serialize-error|non-error|is-network-error|rrule-temporal|type-fest|luxon)/)',
    ],
    clearMocks: true,
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/index.ts',
        '!src/**/*.types.ts',
        '!src/**/*.interfaces.ts',
        '!src/**/*.symbols.ts',
        '!src/**/*.config.ts',
        '!src/server.ts',
        '!tests/**',
    ],
    coverageReporters: ['text', 'lcov', 'cobertura', 'html'],
    coverageThreshold: {
        global: {
            branches: 75,
            functions: 90,
            lines: 90,
            statements: 90,
        },
    },
};

export default config;
