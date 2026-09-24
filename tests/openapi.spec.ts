import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

/**
 * O `openapi.yaml` é servido em `/docs` e vai gerar o cliente do frontend
 * (ADR-0001). Uma referência quebrada nele não aparece em teste de rota nem em
 * gate — aparece para quem for consumir o contrato.
 */
type OpenApiDocument = {
    openapi: string;
    info: { title: string; version: string };
    paths: Record<string, Record<string, unknown>>;
};

const document = yaml.load(
    fs.readFileSync(path.resolve(__dirname, '..', 'docs', 'openapi.yaml'), 'utf8'),
) as OpenApiDocument;

const collectRefs = (node: unknown, found: string[] = []): string[] => {
    if (!node || typeof node !== 'object') return found;

    for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') found.push(value);
        else collectRefs(value, found);
    }

    return found;
};

const resolve = (ref: string): unknown =>
    ref
        .replace('#/', '')
        .split('/')
        .reduce<unknown>(
            (node, key) =>
                node && typeof node === 'object'
                    ? (node as Record<string, unknown>)[key]
                    : undefined,
            document,
        );

const HTTP_METHODS = ['get', 'post', 'patch', 'put', 'delete'];

const operations = Object.entries(
    document.paths as Record<string, Record<string, unknown>>,
).flatMap(([route, methods]) =>
    Object.entries(methods)
        .filter(([method]) => HTTP_METHODS.includes(method))
        .map(([method, operation]) => ({ route, method, operation })),
);

describe('docs/openapi.yaml', () => {
    it('é um documento OpenAPI 3 com título e versão', () => {
        expect(document.openapi).toMatch(/^3\./);
        expect(document.info).toMatchObject({ title: expect.any(String) });
    });

    it('toda referência resolve', () => {
        const quebradas = collectRefs(document).filter((ref) => resolve(ref) === undefined);

        expect(quebradas).toEqual([]);
    });

    it('toda operação tem operationId, e são únicos', () => {
        const ids = operations.map(
            ({ operation }) => (operation as { operationId?: string }).operationId,
        );

        expect(ids.filter((id) => !id)).toEqual([]);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('toda operação declara ao menos uma resposta', () => {
        const semResposta = operations
            .filter(({ operation }) => !(operation as { responses?: unknown }).responses)
            .map(({ method, route }) => `${method.toUpperCase()} ${route}`);

        expect(semResposta).toEqual([]);
    });

    it('toda rota de domínio exige autenticação, e só as de saúde não', () => {
        const semSeguranca = operations
            .filter(({ operation }) => !(operation as { security?: unknown }).security)
            .map(({ route }) => route);

        expect([...new Set(semSeguranca)].sort()).toEqual(['/health', '/health/ready']);
    });
});
