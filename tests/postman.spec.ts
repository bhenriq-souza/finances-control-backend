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
});
