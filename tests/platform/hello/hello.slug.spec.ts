import { readFileSync } from 'fs';
import { join } from 'path';

import { toSlug } from '../../../src/platform/hello/hello.slug';

describe('toSlug (spec 0025)', () => {
    it.each([
        ['João da Silva', 'joao-da-silva'],
        ['Ana-Clara', 'ana-clara'],
        [' Maria   Souza', 'maria-souza'],
    ])('converte %p em %p (AC-0025-07)', (input, expected) => {
        expect(toSlug(input)).toBe(expected);
    });

    it('é determinística e satisfaz o formato do slug (INV-0025-02, INV-0025-05)', () => {
        for (const name of ['Ação', 'José  Álvaro', '-Ana-', 'Åsa Öberg', 'a - b', 'Straße']) {
            const slug = toSlug(name);
            expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
            expect(toSlug(name)).toBe(slug);
        }
    });

    it('slugify consta com versão exata no package.json e no lockfile (INV-0025-04, AC-0025-10)', () => {
        const root = join(__dirname, '../../..');
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
        const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));

        expect(pkg.dependencies.slugify).toBe('1.6.9');
        expect(lock.packages['node_modules/slugify'].version).toBe('1.6.9');
    });
});
