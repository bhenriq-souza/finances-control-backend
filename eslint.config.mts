import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import globals from 'globals';

export default [
    { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'scripts/**'] },
    js.configs.recommended,
    {
        files: ['src/**/*.ts', 'tests/**/*.ts'],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
            globals: { ...globals.node, ...globals.jest },
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin,
            prettier: prettierPlugin,
        },
        rules: {
            ...tseslint.configs.recommended.reduce(
                (acc, config) => ({ ...acc, ...(config.rules ?? {}) }),
                {},
            ),
            ...prettierConfig.rules,
            'prettier/prettier': 'error',
            semi: ['error', 'always'],
            quotes: ['error', 'single', { avoidEscape: true }],
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-explicit-any': 'warn',
            'no-console': ['warn', { allow: ['error'] }],
        },
    },
];
