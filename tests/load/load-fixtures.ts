import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LOAD_FILES, type LoadFile, type LoadFiles } from '../../src/load/validate';

export const FIXTURES_DIR = join(__dirname, 'fixtures');

/** The fictitious fixture set, one entry per tab (INV-0019-07). */
export function fixtureFiles(): Record<LoadFile, string> {
    return Object.fromEntries(
        LOAD_FILES.map((file) => [file, readFileSync(join(FIXTURES_DIR, file), 'utf8')]),
    ) as Record<LoadFile, string>;
}

/** The fixtures with one tab replaced, to build an invalid case. */
export function withTab(file: LoadFile, content: string): LoadFiles {
    return { ...fixtureFiles(), [file]: content };
}

/** The fixtures with text replaced inside one tab. */
export function withReplaced(file: LoadFile, from: string, to: string): LoadFiles {
    const files = fixtureFiles();
    if (!files[file].includes(from)) {
        throw new Error(`fixture ${file} has no "${from}"`);
    }
    return { ...files, [file]: files[file].replace(from, to) };
}
