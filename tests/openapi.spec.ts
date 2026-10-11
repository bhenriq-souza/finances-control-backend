import 'reflect-metadata';

import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';
import type { RouteDef } from '@bhs-dev/typescript-common-types';

import { apiModules } from '../src/api.config';
import { RequireProfileSymbol } from '../src/platform';

/**
 * O `openapi.yaml` é servido em `/docs` e vai gerar o cliente do frontend
 * (ADR-0001). Uma referência quebrada nele não aparece em teste de rota nem em
 * gate — aparece para quem for consumir o contrato.
 */
type OpenApiDocument = {
    openapi: string;
    info: { title: string; version: string };
    servers: { url: string; description: string }[];
    paths: Record<string, Record<string, unknown>>;
    components: {
        schemas: Record<string, Record<string, any>>;
        responses: Record<string, Record<string, any>>;
    };
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

type Operation = { security?: unknown; responses?: Record<string, unknown> };

const HTTP_METHODS = ['get', 'post', 'patch', 'put', 'delete'];

const operations = Object.entries(
    document.paths as Record<string, Record<string, unknown>>,
).flatMap(([route, methods]) =>
    Object.entries(methods)
        .filter(([method]) => HTTP_METHODS.includes(method))
        .map(([method, operation]) => ({ route, method, operation })),
);

/**
 * As rotas que o código publica, lidas das próprias classes de rota: cada uma é
 * instanciada com dependências inertes só para chamar `routes()`, que declara
 * método e caminho sem tocar nelas além de referenciar os handlers.
 *
 * A dependência injetada com `RequireProfileSymbol` não é inerte: é um guarda
 * que devolve um marcador único a cada chamada. Assim, uma rota "guardada por
 * `requireProfile`" é a que traz esse marcador em `middlewares`, sem depender
 * do nome da rota nem de lista mantida à mão (INV-0005-03).
 */
const inert: unknown = new Proxy(() => inert, { get: () => inert, apply: () => inert });

class ProfileGuardMarker {}

const profileGuardStub = (): ProfileGuardMarker => new ProfileGuardMarker();

const publishedRoutes = apiModules.flatMap(({ path: prefix, route }) => {
    if (!prefix || !route) return [];

    // O tsyringe guarda `@inject(token)` como `{ token }` em `injectionTokens`, por índice.
    const tokens = (Reflect.getOwnMetadata('injectionTokens', route.clazz) ?? {}) as Record<
        string,
        { token?: unknown }
    >;
    const args = Array.from({ length: route.clazz.length }, (_, index) =>
        tokens[index]?.token === RequireProfileSymbol ? profileGuardStub : inert,
    );
    const routes = new route.clazz(...args) as { routes(): RouteDef[] };

    return routes.routes().map(({ method, path: sub, middlewares }) => {
        const full = `${prefix}${sub === '/' ? '' : sub}`.replace(/:(\w+)/g, '{$1}');

        return {
            key: `${method.toUpperCase()} ${full}`,
            guardedByProfile: (middlewares ?? []).some((m) => m instanceof ProfileGuardMarker),
        };
    });
});

const publishedKeys = publishedRoutes.map(({ key }) => key);

/**
 * Os códigos de erro que a aplicação emite, lidos do código-fonte (spec 0005,
 * INV-0005-02). Três fontes, todas por texto, com quebra de linha permitida entre
 * os argumentos:
 *
 * 1. `new CustomError(<status>, '<CODE>', …)` e `CustomError.<fábrica>(<mensagem>, '<CODE>', …)`;
 * 2. propriedades `code: '<CODE>'` em maiúsculas: os mapas de conflito de `asConflict`
 *    e as respostas montadas pela plataforma. Os `code: 'custom'` do zod são minúsculos
 *    e ficam de fora;
 * 3. a lista explícita da plataforma, que precisa aparecer como literal em `src/`.
 */
const SRC_DIR = path.resolve(__dirname, '..', 'src');

const listSources = (dir: string): string[] =>
    fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) =>
            entry.isDirectory()
                ? listSources(path.join(dir, entry.name))
                : entry.name.endsWith('.ts')
                  ? [path.join(dir, entry.name)]
                  : [],
        );

const sources = listSources(SRC_DIR).map((file) => fs.readFileSync(file, 'utf8'));

const CODE_ARG = String.raw`'([A-Z][A-Z0-9_]+)'`;
const MESSAGE_ARG = String.raw`(?:'[^']*'|"[^"]*"|\x60[^\x60]*\x60)`;
const NEW_CUSTOM_ERROR = new RegExp(String.raw`new\s+CustomError\(\s*\d+\s*,\s*${CODE_ARG}`, 'g');
const FACTORY_CUSTOM_ERROR = new RegExp(
    String.raw`CustomError\.\w+\(\s*${MESSAGE_ARG}\s*,\s*${CODE_ARG}`,
    'g',
);
const CODE_PROPERTY = new RegExp(String.raw`\bcode:\s*${CODE_ARG}`, 'g');

/** Códigos que a plataforma emite e que o spec 0005 nomeia (`VALIDATION_ERROR`, `INTERNAL_ERROR`, `NOT_READY` e os três de protocolo). */
const PLATFORM_CODES = [
    'VALIDATION_ERROR',
    'INTERNAL_ERROR',
    'NOT_READY',
    'INVALID_JSON',
    'PAYLOAD_TOO_LARGE',
    'ROUTE_NOT_FOUND',
];

/**
 * Chamadas de `CustomError` cujo código não é um literal visível. São as únicas
 * toleradas: `apiModuleNotRecognized()` (boot, nunca chega a um cliente) e o
 * `new CustomError(409, conflict.code, …)` de `asConflict`, cujos códigos vêm dos
 * mapas de conflito, lidos pela fonte 2.
 */
const NON_LITERAL_CALLS = [
    'CustomError.apiModuleNotRecognized(',
    'new CustomError(409, conflict.code,',
];

const codesMatching = (pattern: RegExp): string[] =>
    sources.flatMap((text) => [...text.matchAll(pattern)].map((match) => match[1] as string));

const callSites = (): string[] =>
    sources.flatMap((text) =>
        [...text.matchAll(/new\s+CustomError\([^\n]*|CustomError\.\w+\([^\n]*/g)].map(
            (match) => match[0],
        ),
    );

const emittedCodes = new Set([
    ...codesMatching(NEW_CUSTOM_ERROR),
    ...codesMatching(FACTORY_CUSTOM_ERROR),
    ...codesMatching(CODE_PROPERTY),
    ...PLATFORM_CODES,
]);

const errorCodeEnum: string[] = document.components.schemas.ErrorCode?.enum ?? [];

describe('docs/openapi.yaml', () => {
    it('é um documento OpenAPI 3 com título e versão', () => {
        expect(document.openapi).toMatch(/^3\./);
        expect(document.info).toMatchObject({ title: expect.any(String) });
    });

    it('publica o servidor Dev sob /api e nenhum path conhece o prefixo (INV-0005-04)', () => {
        expect(document.servers).toContainEqual(
            expect.objectContaining({ url: 'http://finances.dev.homelab.local/api' }),
        );
        expect(Object.keys(document.paths).filter((p) => p.startsWith('/api'))).toEqual([]);
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

    it('documenta exatamente as rotas que o código publica', () => {
        const documented = operations.map(
            ({ method, route }) => `${method.toUpperCase()} ${route}`,
        );

        expect(publishedRoutes.length).toBeGreaterThan(0);
        expect(publishedKeys.filter((r) => !documented.includes(r))).toEqual([]);
        expect(documented.filter((r) => !publishedKeys.includes(r))).toEqual([]);
    });

    it('toda rota de domínio exige autenticação, e só as de saúde não', () => {
        const semSeguranca = operations
            .filter(({ operation }) => !(operation as { security?: unknown }).security)
            .map(({ route }) => route);

        expect([...new Set(semSeguranca)].sort()).toEqual(['/health', '/health/ready']);
    });
    describe('contrato de erros (spec 0005)', () => {
        it('toda chamada de CustomError tem código literal visível, salvo as duas conhecidas (INV-0005-02)', () => {
            const literais =
                codesMatching(NEW_CUSTOM_ERROR).length + codesMatching(FACTORY_CUSTOM_ERROR).length;

            expect(callSites().length).toBe(literais + NON_LITERAL_CALLS.length);
            expect(
                callSites().filter((site) =>
                    NON_LITERAL_CALLS.some((known) => site.startsWith(known)),
                ),
            ).toHaveLength(NON_LITERAL_CALLS.length);
        });

        it('os códigos da plataforma aparecem como literal em src/', () => {
            const ausentes = PLATFORM_CODES.filter(
                (code) => !sources.some((text) => text.includes(`'${code}'`)),
            );

            expect(ausentes).toEqual([]);
        });

        it('o ErrorCode não é vazio nem repete código', () => {
            expect(errorCodeEnum.length).toBeGreaterThan(0);
            expect(new Set(errorCodeEnum).size).toBe(errorCodeEnum.length);
        });

        it('todo código emitido em src/ está no ErrorCode (AC-0005-04, INV-0005-02)', () => {
            expect(
                [...emittedCodes].filter((code) => !errorCodeEnum.includes(code)).sort(),
            ).toEqual([]);
        });

        it('todo código do ErrorCode é emitido por alguma fonte (AC-0005-04, INV-0005-02)', () => {
            expect(errorCodeEnum.filter((code) => !emittedCodes.has(code)).sort()).toEqual([]);
        });

        it('Error exige error.code e o refere ao ErrorCode', () => {
            const error = document.components.schemas.Error?.properties?.error;

            expect(error?.required).toEqual(expect.arrayContaining(['message', 'code']));
            expect(error?.properties?.code).toEqual({ $ref: '#/components/schemas/ErrorCode' });
        });

        it('ValidationError e ValidationIssue descrevem as issues do zod', () => {
            const { ValidationError, ValidationIssue } = document.components.schemas;

            expect(ValidationIssue?.required).toEqual(
                expect.arrayContaining(['path', 'code', 'message']),
            );
            expect(ValidationIssue?.additionalProperties).toBe(true);
            expect(ValidationIssue?.properties?.path).toMatchObject({
                type: 'array',
                items: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
            });
            expect(JSON.stringify(ValidationError)).toContain('VALIDATION_ERROR');
            expect(JSON.stringify(ValidationError)).toContain(
                '#/components/schemas/ValidationIssue',
            );
        });

        it('as respostas reutilizáveis ValidationFailed, Unauthenticated e Forbidden existem', () => {
            const { ValidationFailed, Unauthenticated, Forbidden } = document.components.responses;

            expect(ValidationFailed?.content['application/json'].schema).toEqual({
                $ref: '#/components/schemas/ValidationError',
            });
            expect(Unauthenticated?.content['application/json'].schema).toEqual({
                $ref: '#/components/schemas/Error',
            });
            expect(Forbidden?.content['application/json'].schema).toEqual({
                $ref: '#/components/schemas/Error',
            });
        });

        it('toda operação com security declara 401 (AC-0005-05, INV-0005-03)', () => {
            const sem401 = operations
                .filter(({ operation }) => (operation as Operation).security)
                .filter(({ operation }) => !(operation as Operation).responses?.['401'])
                .map(({ method, route }) => `${method.toUpperCase()} ${route}`);

            expect(sem401).toEqual([]);
        });

        it('toda operação guardada por requireProfile declara 403, e GET /users/me não (AC-0005-05, INV-0005-03)', () => {
            const guarded = publishedRoutes.filter(({ guardedByProfile }) => guardedByProfile);
            const byKey = new Map(
                operations.map(({ method, route, operation }) => [
                    `${method.toUpperCase()} ${route}`,
                    operation as Operation,
                ]),
            );

            expect(guarded.length).toBeGreaterThan(0);
            expect(guarded.map(({ key }) => key)).not.toContain('GET /users/me');
            expect(
                guarded
                    .filter(({ key }) => !byKey.get(key)?.responses?.['403'])
                    .map(({ key }) => key),
            ).toEqual([]);
            expect(byKey.get('GET /users/me')?.responses?.['403']).toBeUndefined();
        });

        it('ReadinessReport descreve checks.jobs como up, down ou disabled (AC-0005-07)', () => {
            const jobs = document.components.schemas.ReadinessReport?.properties?.checks?.properties
                ?.jobs as { enum?: string[] } | undefined;

            expect([...(jobs?.enum ?? [])].sort()).toEqual(['disabled', 'down', 'up']);
        });
    });
});
