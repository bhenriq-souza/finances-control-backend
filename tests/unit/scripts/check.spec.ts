import { ALL_GATES, FULL, runCheck } from './check-fixture';

// Spec 0002: orquestrador único dos gates (scripts/check.mjs), exercitado como processo
// contra um repositório de fixture descartável (ver check-fixture.ts). O fixture não tem
// package-lock.json, então o gate `audit` é sempre SKIP e nada toca a rede; por isso o
// caminho "nenhum gate pulado, saída 0" do --require-tools fica para o CI (INV-0002-05).
describe('scripts/check.mjs', () => {
    describe('AC-0002-01 / INV-0002-01: executa os gates e imprime a tabela final', () => {
        it('lista todos os gates da spec, na ordem, com PASS e SKIP com motivo', () => {
            const run = runCheck(FULL);

            expect(Object.keys(run.table)).toEqual([...ALL_GATES]);
            for (const gate of ALL_GATES.filter((g) => g !== 'audit')) {
                expect(run.table[gate]).toEqual({ status: 'PASS', reason: '' });
            }
            expect(run.table.audit).toEqual({
                status: 'SKIP',
                reason: 'package-lock.json ainda não existe neste repositório',
            });
            expect(run.stdout).toContain('Tudo verde (6 executados, 1 pulados).');
        });

        it('executa de fato cada ferramenta disponível', () => {
            const { stdout } = runCheck(FULL);

            for (const tool of ['prettier', 'eslint', 'tsc', 'depcruise', 'jest', 'specs']) {
                expect(stdout).toContain(`fake ${tool} executado`);
            }
        });
    });

    describe('INV-0002-02: gate ausente é SKIP com motivo, nunca PASS', () => {
        it('SKIP com o motivo de cada causa e nenhuma ferramenta executada', () => {
            const run = runCheck({ undeclared: ['format'], notInstalled: ['lint'] });

            expect(run.table.format).toEqual({
                status: 'SKIP',
                reason: 'prettier não está declarado no package.json',
            });
            expect(run.table.lint).toEqual({
                status: 'SKIP',
                reason: 'eslint declarado mas não instalado (rode npm ci)',
            });
            expect(run.table.types).toEqual({
                status: 'SKIP',
                reason: 'tsconfig.json ainda não existe neste repositório',
            });
            expect(run.table.boundaries).toEqual({
                status: 'SKIP',
                reason: '.dependency-cruiser.cjs ainda não existe neste repositório',
            });
            expect(run.table.test).toEqual({
                status: 'SKIP',
                reason: 'tests ainda não existe neste repositório',
            });
            expect(run.table.specs).toEqual({
                status: 'SKIP',
                reason: 'scripts/check-specs.mjs ainda não existe neste repositório',
            });
            expect(Object.values(run.table).every((g) => g.status === 'SKIP')).toBe(true);
            expect(run.stdout).not.toContain('fake ');
        });

        it('sem package.json, os gates de ferramenta são SKIP (contexto)', () => {
            const run = runCheck({ ...FULL, noManifest: true });

            for (const gate of ['format', 'lint', 'types', 'boundaries', 'test'] as const) {
                expect(run.table[gate]).toEqual({
                    status: 'SKIP',
                    reason: 'package.json ainda não existe (scaffold pendente — FCB-002)',
                });
            }
            expect(run.table.specs.status).toBe('PASS');
        });

        it('modo normal: SKIP não afeta o código de saída', () => {
            const run = runCheck({ ...FULL, undeclared: ['format'] });

            expect(run.table.format.status).toBe('SKIP');
            expect(run.status).toBe(0);
        });
    });

    describe('AC-0002-02 / INV-0002-04: código de saída', () => {
        it('sai com 0 quando não há falha', () => {
            expect(runCheck(FULL).status).toBe(0);
        });

        it('sai com 1 quando um gate falha, com o motivo na tabela', () => {
            const run = runCheck({ ...FULL, failing: ['types'] });

            expect(run.status).toBe(1);
            expect(run.table.types).toEqual({ status: 'FAIL', reason: 'código de saída 1' });
            expect(run.stderr).toContain('Bloqueando: types');
        });

        it('segue até o fim: registra todas as falhas e executa os gates seguintes', () => {
            const run = runCheck({
                ...FULL,
                failing: ['format', 'boundaries'],
                failingSpecs: true,
            });

            expect(run.status).toBe(1);
            expect(run.table.format.status).toBe('FAIL');
            expect(run.table.lint.status).toBe('PASS');
            expect(run.table.boundaries.status).toBe('FAIL');
            expect(run.table.test.status).toBe('PASS');
            expect(run.table.specs.status).toBe('FAIL');
            expect(run.stdout).toContain('fake jest executado');
            expect(run.stderr).toContain('Bloqueando: format, boundaries, specs');
        });
    });

    describe('AC-0002-03: --require-tools', () => {
        it('converte SKIP em falha e sai com 1, listando os gates pulados', () => {
            const run = runCheck({ ...FULL, undeclared: ['lint'] }, ['--require-tools']);

            expect(run.status).toBe(1);
            expect(run.stdout).toContain('modo estrito: SKIP conta como falha');
            expect(run.table.lint).toEqual({
                status: 'SKIP',
                reason: 'eslint não está declarado no package.json',
            });
            expect(run.stderr).toContain('Modo estrito: 2 gate(s) pulado(s)');
            expect(run.stderr).toContain('Bloqueando: lint, audit');
        });

        it('o mesmo repositório, sem a flag, sai com 0', () => {
            const run = runCheck({ ...FULL, undeclared: ['lint'] });

            expect(run.status).toBe(0);
        });

        it('mantém as falhas reais no modo estrito', () => {
            const run = runCheck({ ...FULL, failing: ['test'] }, ['--require-tools']);

            expect(run.status).toBe(1);
            expect(run.stderr).toContain('Bloqueando: test, audit');
        });
    });
});
