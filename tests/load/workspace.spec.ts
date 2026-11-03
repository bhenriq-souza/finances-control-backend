import 'reflect-metadata';
import type { DataSource } from 'typeorm';

import { composeLoad, type LoadServices } from '../../src/load/compose';
import { runCli, type LoadSession } from '../../src/load/main';
import { createIsolatedDataSource, dropIsolatedDataSource } from '../integration/database.helper';
import { FIXTURES_DIR } from './load-fixtures';

const SCHEMA = 'test_load_workspace';
const UNKNOWN_WORKSPACE = '00000000-0000-4000-8000-000000000000';

describe('carga inicial por espaço (spec 0021, Carga inicial)', () => {
    let dataSource: DataSource;
    let services: LoadServices;
    let workspaceA: string;
    let workspaceB: string;

    const insertWorkspace = async (name: string): Promise<string> =>
        (
            (await dataSource.query('INSERT INTO workspaces (name) VALUES ($1) RETURNING id', [
                name,
            ])) as { id: string }[]
        )[0]!.id;

    const countIn = async (table: string, workspaceId: string): Promise<number> =>
        Number(
            (
                (await dataSource.query(
                    `SELECT count(*) AS n FROM ${table} WHERE workspace_id = $1`,
                    [workspaceId],
                )) as [{ n: string }]
            )[0].n,
        );

    const run = async (argv: string[]) => {
        const out: string[] = [];
        const err: string[] = [];
        const open = jest.fn((): Promise<LoadSession> =>
            Promise.resolve({ services, close: () => Promise.resolve() }),
        );
        const code = await runCli(
            argv,
            { out: (line) => out.push(line), err: (line) => err.push(line) },
            open,
        );

        return { code, out, err, open };
    };

    beforeAll(async () => {
        dataSource = await createIsolatedDataSource(SCHEMA);
        await dataSource.runMigrations();
        services = await composeLoad(dataSource);
        workspaceA = await insertWorkspace('A');
        workspaceB = await insertWorkspace('B');
    });

    afterAll(async () => {
        await dropIsolatedDataSource(dataSource, SCHEMA);
    });

    it('ERR-0021-14, AC-0021-19: sem --workspace a CLI termina com 1 sem abrir o banco nem ler a planilha', async () => {
        const { code, open, err } = await run(['--dir', FIXTURES_DIR]);

        expect(code).toBe(1);
        expect(err).toHaveLength(1);
        expect(open).not.toHaveBeenCalled();
    });

    it('ERR-0021-14: espaço inexistente (ou id malformado) termina com 1 e nada é gravado', async () => {
        for (const id of [UNKNOWN_WORKSPACE, 'nao-e-um-id']) {
            const { code, err } = await run(['--dir', FIXTURES_DIR, '--workspace', id]);

            expect(code).toBe(1);
            expect(err).toEqual([`espaço não encontrado: ${id}`]);
        }
        expect(await countIn('bank_accounts', workspaceA)).toBe(0);
        expect(await countIn('bank_accounts', workspaceB)).toBe(0);
    });

    it('AC-0021-19: a carga com --workspace de B grava tudo em B e nada em A', async () => {
        const { code, err } = await run(['--dir', FIXTURES_DIR, '--workspace', workspaceB]);

        expect(err).toEqual([]);
        expect(code).toBe(0);
        for (const table of ['bank_accounts', 'credit_cards', 'expenses', 'earnings']) {
            expect(await countIn(table, workspaceB)).toBeGreaterThan(0);
            expect(await countIn(table, workspaceA)).toBe(0);
        }
    });

    it('AC-0021-19: repetir a carga em A cria os registros de A sem tocar nos de B', async () => {
        const before = await countIn('bank_accounts', workspaceB);

        const { code, err } = await run(['--dir', FIXTURES_DIR, '--workspace', workspaceA]);

        expect(err).toEqual([]);
        expect(code).toBe(0);
        expect(await countIn('bank_accounts', workspaceA)).toBe(before);
        expect(await countIn('bank_accounts', workspaceB)).toBe(before);
    });
});
