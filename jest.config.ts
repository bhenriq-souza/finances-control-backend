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
