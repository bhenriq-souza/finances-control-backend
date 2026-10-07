import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// O orquestrador resolve ROOT a partir do próprio caminho (`scripts/..`). Para testá-lo como
// processo sem alterá-lo, cada cenário monta um repositório descartável com uma cópia do
// script e ferramentas falsas em node_modules/.bin, que o `npx` encontra localmente.

const REAL_SCRIPT = resolve(__dirname, '../../../scripts/check.mjs');

/** Ferramenta falsa: binário em node_modules/.bin e pacote que o gate confere. */
const TOOLS = [
    { gate: 'format', bin: 'prettier', pkg: 'prettier' },
    { gate: 'lint', bin: 'eslint', pkg: 'eslint' },
    { gate: 'types', bin: 'tsc', pkg: 'typescript' },
    { gate: 'boundaries', bin: 'depcruise', pkg: 'dependency-cruiser' },
    { gate: 'test', bin: 'jest', pkg: 'jest' },
] as const;

export type ToolGate = (typeof TOOLS)[number]['gate'];

export interface FixtureOptions {
    /** Gates cuja ferramenta falsa sai com 1. */
    failing?: ToolGate[];
    /** Gates cujo pacote não está declarado no package.json. */
    undeclared?: ToolGate[];
    /** Gates cujo pacote está declarado mas ausente do node_modules. */
    notInstalled?: ToolGate[];
    /** Não cria o package.json. */
    noManifest?: boolean;
    /** Cria o `scripts/check-specs.mjs` falso (sai com 0, ou 1 se `failingSpecs`). */
    withSpecsScript?: boolean;
    failingSpecs?: boolean;
    /** Arquivos/diretórios que os gates conferem. */
    withTsconfig?: boolean;
    withDepcruiseConfig?: boolean;
    withSrc?: boolean;
    withTests?: boolean;
}

export interface CheckRun {
    status: number | null;
    stdout: string;
    stderr: string;
    /** Linhas da tabela "Resumo", por gate. */
    table: Record<Gate, { status: string; reason: string }>;
}

export const ALL_GATES = [
    'format',
    'lint',
    'types',
    'boundaries',
    'test',
    'audit',
    'specs',
] as const;

export type Gate = (typeof ALL_GATES)[number];

/**
 * Repositório completo: nenhum gate é pulado, exceto `audit`. Não há `package-lock.json` de
 * propósito, para que o `npm audit` não toque a rede.
 */
export const FULL: FixtureOptions = {
    withSpecsScript: true,
    withTsconfig: true,
    withDepcruiseConfig: true,
    withSrc: true,
    withTests: true,
};

function fakeTool(label: string, exitCode: number): string {
    return `#!/bin/sh\necho "fake ${label} executado"\nexit ${exitCode}\n`;
}

function parseTable(stdout: string): CheckRun['table'] {
    const table: Record<string, { status: string; reason: string }> = {};
    const summary = stdout.split('Resumo')[1] ?? '';
    for (const line of summary.split('\n')) {
        const match = /^ {2}(\w+)\s+(PASS|FAIL|SKIP)(?: {2}— (.*))?$/.exec(line);
        if (match?.[1] && match[2]) {
            table[match[1]] = { status: match[2], reason: match[3] ?? '' };
        }
    }
    return table as CheckRun['table'];
}

export function runCheck(options: FixtureOptions, args: string[] = []): CheckRun {
    const root = mkdtempSync(join(tmpdir(), 'check-fixture-'));
    try {
        mkdirSync(join(root, 'scripts'));
        copyFileSync(REAL_SCRIPT, join(root, 'scripts', 'check.mjs'));

        if (!options.noManifest) {
            const declared = TOOLS.filter((t) => !options.undeclared?.includes(t.gate));
            const devDependencies = Object.fromEntries(declared.map((t) => [t.pkg, '*']));
            writeFileSync(
                join(root, 'package.json'),
                JSON.stringify({ name: 'fixture', devDependencies }),
            );
        }

        const bin = join(root, 'node_modules', '.bin');
        mkdirSync(bin, { recursive: true });
        for (const tool of TOOLS) {
            if (!options.notInstalled?.includes(tool.gate)) {
                mkdirSync(join(root, 'node_modules', tool.pkg), { recursive: true });
            }
            const file = join(bin, tool.bin);
            writeFileSync(file, fakeTool(tool.bin, options.failing?.includes(tool.gate) ? 1 : 0));
            chmodSync(file, 0o755);
        }

        if (options.withSpecsScript) {
            writeFileSync(
                join(root, 'scripts', 'check-specs.mjs'),
                `console.log('fake specs executado');\nprocess.exit(${options.failingSpecs ? 1 : 0});\n`,
            );
        }
        if (options.withTsconfig) writeFileSync(join(root, 'tsconfig.json'), '{}');
        if (options.withDepcruiseConfig) writeFileSync(join(root, '.dependency-cruiser.cjs'), '');
        if (options.withSrc) mkdirSync(join(root, 'src'));
        if (options.withTests) mkdirSync(join(root, 'tests'));

        const result = spawnSync('node', [join(root, 'scripts', 'check.mjs'), ...args], {
            cwd: root,
            encoding: 'utf8',
            timeout: 60_000,
        });
        return {
            status: result.status,
            stdout: result.stdout,
            stderr: result.stderr,
            table: parseTable(result.stdout),
        };
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}
