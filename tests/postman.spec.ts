import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * A collection do Postman em `docs/postman/` é gerada do `openapi.yaml`. Se o
 * contrato mudar sem regerá-la, ela passa a mentir para quem testa à mão.
 */
describe('docs/postman', () => {
    it('está em dia com o openapi.yaml (`npm run postman`)', () => {
        const script = path.resolve(__dirname, '..', 'scripts', 'postman.mjs');

        expect(() =>
            execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' }),
        ).not.toThrow();
    });

    it('o ambiente dev aponta para a URL sob /api (AC-0005-08)', () => {
        const env = JSON.parse(
            fs.readFileSync(
                path.resolve(__dirname, '..', 'docs', 'postman', 'dev.postman_environment.json'),
                'utf8',
            ),
        ) as { values: { key: string; value: string }[] };

        expect(env.values.find((v) => v.key === 'baseUrl')?.value).toBe(
            'http://finances.dev.homelab.local/api',
        );
    });
});
