import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { formatValidation } from './report';
import { LOAD_FILES, validateLoad, type LoadFiles } from './validate';

export type CliIo = {
    out: (line: string) => void;
    err: (line: string) => void;
};

export type CliOptions = { dir: string; dryRun: boolean };

const USAGE = 'uso: npm run load:initial -- --dir <pasta> [--dry-run]';

/** `--dir <pasta> [--dry-run]` (spec 0019, _Comando_); `undefined` when the arguments are wrong. */
export function parseArgs(argv: readonly string[]): CliOptions | undefined {
    let dir: string | undefined;
    let dryRun = false;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--dry-run') {
            dryRun = true;
        } else if (arg === '--dir' && argv[index + 1] !== undefined) {
            dir = argv[index + 1];
            index += 1;
        } else {
            return undefined;
        }
    }
    return dir === undefined ? undefined : { dir, dryRun };
}

/** Reads `<dir>/<aba>.csv` for every tab; a file that does not exist is left out (ERR-0019-01). */
export function readLoadFiles(dir: string): LoadFiles {
    const files: LoadFiles = {};
    for (const file of LOAD_FILES) {
        const path = join(dir, file);
        if (existsSync(path)) {
            files[file] = readFileSync(path, 'utf8');
        }
    }
    return files;
}

/**
 * Runs the initial load and returns the exit code: `0` when validation passes, `1` on any error
 * (spec 0019, _Comando_). Writing is T-0019-02; until then only `--dry-run` is accepted.
 */
export function runCli(argv: readonly string[], io: CliIo): number {
    const options = parseArgs(argv);
    if (!options) {
        io.err(USAGE);
        return 1;
    }
    if (!existsSync(options.dir)) {
        io.err(`pasta não encontrada: ${options.dir}`);
        return 1;
    }

    const validation = validateLoad(readLoadFiles(options.dir));
    const lines = formatValidation(validation);
    if (validation.errors.length > 0) {
        lines.forEach(io.err);
        return 1;
    }
    lines.forEach(io.out);

    if (!options.dryRun) {
        io.err('a gravação ainda não está disponível; rode com --dry-run');
        return 1;
    }
    return 0;
}
