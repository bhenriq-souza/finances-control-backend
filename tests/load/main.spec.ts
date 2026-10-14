import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseArgs, readLoadFiles, runCli } from '../../src/load/main';
import { FIXTURES_DIR } from './load-fixtures';

const run = (argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = runCli(argv, { out: (line) => out.push(line), err: (line) => err.push(line) });
    return { code, out, err };
};

describe('carga inicial: comando (spec 0019, Comando)', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'load-'));
        cpSync(FIXTURES_DIR, dir, { recursive: true });
    });

    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('lê os argumentos --dir e --dry-run', () => {
        expect(parseArgs(['--dir', '/x', '--dry-run'])).toEqual({ dir: '/x', dryRun: true });
        expect(parseArgs(['--dry-run', '--dir', '/x'])).toEqual({ dir: '/x', dryRun: true });
        expect(parseArgs(['--dir', '/x'])).toEqual({ dir: '/x', dryRun: false });
        expect(parseArgs([])).toBeUndefined();
        expect(parseArgs(['--dir'])).toBeUndefined();
        expect(parseArgs(['--dir', '/x', '--force'])).toBeUndefined();
    });

    it('AC-0019-03: --dry-run imprime o plano, o lembrete da fatura e sai com 0', () => {
        const { code, out, err } = run(['--dir', dir, '--dry-run']);

        expect(code).toBe(0);
        expect(err).toEqual([]);
        expect(out[0]).toBe('Plano da carga:');
        expect(out).toContainEqual(
            expect.stringMatching(
                /^contas\.csv +a importar: +3 +ignorados \(importar = não\): +1$/,
            ),
        );
        expect(out).toContain('tipos de despesa ativos ao final: 3; os demais serão arquivados');
        expect(out).toContain(
            'lembrete: em 2026-10-16, registre o pagamento antecipado de R$ 2.345,67 da fatura aberta do cartão Alfa Black, pela conta Alfa CC',
        );
    });

    it('imprime os avisos depois do plano', () => {
        const file = join(dir, 'despesas_parceladas.csv');
        writeFileSync(
            file,
            'descricao,tipo_despesa,valor_parcela,conta,cartao,data_proxima_parcela,parcela_proxima,parcelas_total,parcelas_restantes,importar,observacao\nX,Casa,1,Alfa CC,,2026-11-01,1,9,2,sim,\n',
        );

        const { code, out } = run(['--dir', dir, '--dry-run']);

        expect(code).toBe(0);
        expect(out.at(-1)).toMatch(/^aviso despesas_parceladas\.csv:2: parcela_proxima \(1\)/);
    });

    it('AC-0019-02, INV-0019-01: erros saem todos juntos no stderr, com código 1', () => {
        rmSync(join(dir, 'bancos.csv'));
        rmSync(join(dir, 'recebimentos.csv'));

        const { code, out, err } = run(['--dir', dir, '--dry-run']);

        expect(code).toBe(1);
        expect(out).toEqual([]);
        expect(err).toEqual([
            '2 erro(s) de validação; nada foi gravado.',
            'bancos.csv: arquivo ausente (ERR-0019-01)',
            'recebimentos.csv: arquivo ausente (ERR-0019-01)',
        ]);
    });

    it('cita arquivo, linha e coluna no erro', () => {
        writeFileSync(
            join(dir, 'tipos_despesa.csv'),
            'nome,importar,observacao\nCasa,sim,\nCasa,sim,\nSaúde,sim,\nCartão de Crédito,sim,\n',
        );

        const { code, err } = run(['--dir', dir, '--dry-run']);

        expect(code).toBe(1);
        expect(err).toContain('tipos_despesa.csv:3 nome: repetido na linha 2 (ERR-0019-05)');
    });

    it('sem --dry-run, a gravação ainda não existe (T-0019-02)', () => {
        const { code, err } = run(['--dir', dir]);

        expect(code).toBe(1);
        expect(err).toEqual(['a gravação ainda não está disponível; rode com --dry-run']);
    });

    it('argumentos errados e pasta inexistente saem com 1', () => {
        expect(run([]).err).toEqual(['uso: npm run load:initial -- --dir <pasta> [--dry-run]']);
        expect(run(['--dir', join(dir, 'nao-existe')])).toMatchObject({
            code: 1,
            err: [`pasta não encontrada: ${join(dir, 'nao-existe')}`],
        });
    });

    it('lê só os arquivos que existem na pasta', () => {
        rmSync(join(dir, 'cartoes.csv'));

        const files = readLoadFiles(dir);

        expect(Object.keys(files)).not.toContain('cartoes.csv');
        expect(Object.keys(files)).toHaveLength(7);
    });
});
