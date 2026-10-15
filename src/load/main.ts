import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LoadServices } from './compose';
import { formatValidation, formatWriteResult } from './report';
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

/** The database side of the load: services to write through and a way to close the connection. */
export type LoadSession = { services: LoadServices; close: () => Promise<void> };

/**
 * Opens the database only after validation passes, so a sheet with errors never needs one. The
 * import is lazy because loading the modules builds the connection from `DATABASE_URL`.
 */
const openSession = async (): Promise<LoadSession> => {
    const { composeLoad } = await import('./compose');
    const { AppDataSource } = await import('../platform');
    return { services: await composeLoad(), close: () => AppDataSource.destroy() };
};

/**
 * Runs the initial load and returns the exit code: `0` when it ends without errors, `1` otherwise
 * (spec 0019, _Comando_). Validation runs first and stops everything on any error
 * (INV-0019-01); then the plan is compared with the database and, without `--dry-run`, written.
 */
export async function runCli(
    argv: readonly string[],
    io: CliIo,
    open: () => Promise<LoadSession> = openSession,
): Promise<number> {
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

    const { writePlan } = await import('./write');
    const session = await open();
    try {
        const result = await writePlan(validation.plan, session.services, {
            dryRun: options.dryRun,
        });
        const report = formatWriteResult(result, options.dryRun);
        if (result.errors.length > 0) {
            report.forEach(io.err);
            return 1;
        }
        report.forEach(io.out);
        return 0;
    } finally {
        await session.close();
    }
}
