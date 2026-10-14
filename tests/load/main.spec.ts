import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseArgs, readLoadFiles, runCli, type LoadSession } from '../../src/load/main';
import { writePlan, type WriteResult } from '../../src/load/write';
import { FIXTURES_DIR } from './load-fixtures';

// O lado do banco é coberto pelo teste de integração; aqui só o fluxo do comando.
jest.mock('../../src/load/write', () => ({ writePlan: jest.fn() }));

const counts = (created: number) => ({ created, existing: 0 });
const written = (errors: WriteResult['errors'] = []): WriteResult => ({
    sections: {
        bancos: counts(2),
        contas: counts(3),
        cartoes: counts(2),
        tipos_despesa: { created: 2, existing: 1, archived: 9 },
        despesas: counts(4),
        faturas_em_aberto: counts(1),
        recebimentos: counts(3),
    },
    errors,
});

const close = jest.fn(() => Promise.resolve());
const open = jest.fn((): Promise<LoadSession> =>
    Promise.resolve({ services: {} as LoadSession['services'], close }),
);

const run = async (argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(
        argv,
        { out: (line) => out.push(line), err: (line) => err.push(line) },
        open,
    );
    return { code, out, err };
};

describe('carga inicial: comando (spec 0019, Comando)', () => {
    let dir: string;

    beforeEach(() => {
        jest.mocked(writePlan).mockResolvedValue(written());
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

    it('AC-0019-03: --dry-run imprime o plano, a simulação contra o banco e o lembrete', async () => {
        const { code, out, err } = await run(['--dir', dir, '--dry-run']);

        expect(code).toBe(0);
        expect(err).toEqual([]);
        expect(out[0]).toBe('Plano da carga:');
        expect(out).toContainEqual(
            expect.stringMatching(
                /^contas\.csv +a importar: +3 +ignorados \(importar = não\): +1$/,
            ),
        );
        expect(out).toContain(
            'lembrete: em 2026-10-16, registre o pagamento antecipado de R$ 2.345,67 da fatura aberta do cartão Alfa Black, pela conta Alfa CC',
        );
        expect(out).toContain('Simulação contra o banco (nada foi gravado):');
        expect(out).toContainEqual(
            expect.stringMatching(
                /^tipos de despesa +a criar: +2 +já existiam: +1 +a arquivar: +9$/,
            ),
        );
        expect(jest.mocked(writePlan).mock.calls[0]?.[2]).toEqual({ dryRun: true });
        expect(close).toHaveBeenCalled();
    });

    it('sem --dry-run, grava e imprime o resultado', async () => {
        const { code, out } = await run(['--dir', dir]);

        expect(code).toBe(0);
        expect(out).toContain('Carga gravada:');
        expect(out).toContainEqual(expect.stringMatching(/^bancos +criados: +2 +já existiam: +0$/));
        expect(jest.mocked(writePlan).mock.calls[0]?.[2]).toEqual({ dryRun: false });
    });

    it('ERR-0019-07: carga interrompida sai com 1, com o erro e o que já foi gravado', async () => {
        jest.mocked(writePlan).mockResolvedValue(
            written([
                { code: 'ERR-0019-07', file: 'recebimentos.csv', line: 3, message: 'X: recusado' },
            ]),
        );

        const { code, err } = await run(['--dir', dir]);

        expect(code).toBe(1);
        expect(err.slice(0, 2)).toEqual([
            'Carga interrompida; o que já foi gravado permanece:',
            'recebimentos.csv:3: X: recusado (ERR-0019-07)',
        ]);
        expect(err).toContainEqual(expect.stringMatching(/^recebimentos +criados: +3/));
        expect(close).toHaveBeenCalled();
    });

    it('simulação recusada (tipo de receita ausente) sai com 1, sem contagens', async () => {
        jest.mocked(writePlan).mockResolvedValue(
            written([
                {
                    code: 'ERR-0019-03',
                    file: 'recebimentos.csv',
                    line: 2,
                    column: 'tipo_receita',
                    message: '"X" não é um tipo de receita ativo no sistema',
                },
            ]),
        );

        const { code, err } = await run(['--dir', dir, '--dry-run']);

        expect(code).toBe(1);
        expect(err).toEqual([
            'Simulação recusada:',
            'recebimentos.csv:2 tipo_receita: "X" não é um tipo de receita ativo no sistema (ERR-0019-03)',
        ]);
    });

    it('imprime os avisos depois do plano', async () => {
        const file = join(dir, 'despesas_parceladas.csv');
        writeFileSync(
            file,
            'descricao,tipo_despesa,valor_parcela,conta,cartao,data_proxima_parcela,parcela_proxima,parcelas_total,parcelas_restantes,importar,observacao\nX,Casa,1,Alfa CC,,2026-11-01,1,9,2,sim,\n',
        );

        const { code, out } = await run(['--dir', dir, '--dry-run']);

        expect(code).toBe(0);
        expect(out).toContainEqual(
            expect.stringMatching(/^aviso despesas_parceladas\.csv:2: parcela_proxima \(1\)/),
        );
    });

    it('AC-0019-02, INV-0019-01: erros de validação saem juntos no stderr e o banco nem é aberto', async () => {
        rmSync(join(dir, 'bancos.csv'));
        rmSync(join(dir, 'recebimentos.csv'));

        const { code, out, err } = await run(['--dir', dir, '--dry-run']);

        expect(code).toBe(1);
        expect(out).toEqual([]);
        expect(err).toEqual([
            '2 erro(s) de validação; nada foi gravado.',
            'bancos.csv: arquivo ausente (ERR-0019-01)',
            'recebimentos.csv: arquivo ausente (ERR-0019-01)',
        ]);
        expect(open).not.toHaveBeenCalled();
    });

    it('cita arquivo, linha e coluna no erro', async () => {
        writeFileSync(
            join(dir, 'tipos_despesa.csv'),
            'nome,importar,observacao\nCasa,sim,\nCasa,sim,\nSaúde,sim,\nCartão de Crédito,sim,\n',
        );

        const { code, err } = await run(['--dir', dir, '--dry-run']);

        expect(code).toBe(1);
        expect(err).toContain('tipos_despesa.csv:3 nome: repetido na linha 2 (ERR-0019-05)');
    });

    it('argumentos errados e pasta inexistente saem com 1', async () => {
        expect((await run([])).err).toEqual([
            'uso: npm run load:initial -- --dir <pasta> [--dry-run]',
        ]);
        expect(await run(['--dir', join(dir, 'nao-existe')])).toMatchObject({
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
