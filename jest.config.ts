import type { Config } from 'jest';

const config: Config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src', '<rootDir>/tests'],
    testMatch: ['**/?(*.)+(spec|test).ts'],
    setupFiles: ['<rootDir>/tests/setup.ts'],
    clearMocks: true,
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/index.ts',
        '!src/**/*.types.ts',
        '!src/**/*.interfaces.ts',
        '!src/**/*.symbols.ts',
        '!src/**/*.config.ts',
        '!src/server.ts',
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
