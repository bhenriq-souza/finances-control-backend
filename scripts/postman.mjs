#!/usr/bin/env node
// Gera a collection e os ambientes do Postman a partir de docs/openapi.yaml.
//
//   node scripts/postman.mjs           escreve docs/postman/
//   node scripts/postman.mjs --check   falha se docs/postman/ estiver defasado
//
// A saída é determinística (sem ids aleatórios nem datas), para que regerar sem
// mudança no contrato não produza diff. Os valores sensíveis dos ambientes
// (chave do Firebase, email, senha, token) saem sempre vazios.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import yaml from 'js-yaml';
import prettier from 'prettier';

const ROOT = resolve(import.meta.dirname, '..');
const OPENAPI = resolve(ROOT, 'docs/openapi.yaml');
const OUT_DIR = resolve(ROOT, 'docs/postman');

const COLLECTION_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Ambientes: o nome do arquivo e o servidor do `openapi.yaml` que ele usa. */
const ENVIRONMENTS = [
    { file: 'local', name: 'Finances Control — local', server: 'http://localhost:3000' },
    { file: 'dev', name: 'Finances Control — dev', server: 'http://finances.dev.homelab.local' },
];

const doc = yaml.load(readFileSync(OPENAPI, 'utf8'));

const deref = (node) => {
    if (!node || typeof node !== 'object' || !node.$ref) return node;

    const target = node.$ref
        .replace('#/', '')
        .split('/')
        .reduce((acc, key) => acc?.[key], doc);

    return deref(target);
};

const camel = (s) => s.replace(/-(\w)/g, (_, c) => c.toUpperCase());
const singular = (s) => (s.endsWith('ies') ? `${s.slice(0, -3)}y` : s.replace(/s$/, ''));

/** `/bank-accounts/{id}` → `bankAccountId`: a variável que guarda o id do recurso. */
const idVariableFor = (segments, param) => {
    if (param !== 'id') return param;

    const index = segments.indexOf(`{${param}}`);

    return `${camel(singular(segments[index - 1]))}Id`;
};

const operations = Object.entries(doc.paths).flatMap(([route, pathItem]) =>
    HTTP_METHODS.filter((m) => pathItem[m]).map((method) => ({
        route,
        method,
        op: pathItem[method],
        params: [...(pathItem.parameters ?? []), ...(pathItem[method].parameters ?? [])].map(deref),
    })),
);

/** Toda variável de id que a collection usa, dos caminhos e das capturas. */
const idVariables = new Set(['toBankAccountId']);

for (const { route, method } of operations) {
    const segments = route.split('/').filter(Boolean);

    for (const s of segments) {
        const m = s.match(/^\{(\w+)\}$/);
        if (m) idVariables.add(idVariableFor(segments, m[1]));
    }

    const last = segments.at(-1);
    if (method === 'post' && !last.startsWith('{') && last !== 'archive') {
        idVariables.add(`${camel(singular(last))}Id`);
    }
}

/** Campo de corpo com uuid → a variável que tem esse id (`fromBankAccountId` → `bankAccountId`). */
const variableForField = (field) => {
    const stripped = field.replace(/^[a-z]+(?=[A-Z])/, '');
    const candidate = stripped.charAt(0).toLowerCase() + stripped.slice(1);
    const variable = idVariables.has(field) || !idVariables.has(candidate) ? field : candidate;

    usedVariables.add(variable);

    return variable;
};

/** Variáveis de id que os corpos e as queries usam, para entrarem nos ambientes. */
const usedVariables = new Set();

/**
 * Exemplo de valor a partir do schema. No corpo entram só os campos obrigatórios;
 * sem nenhum (os `PATCH`), entra um campo só, para o exemplo não ser vazio.
 */
const sample = (schema, field = '') => {
    const s = deref(schema) ?? {};

    if (s.example !== undefined) return s.example;
    if (s.oneOf) {
        // Ramos só com `required` refinam o schema pai em vez de substituí-lo.
        const branch = deref(s.oneOf[0]);
        const merged = branch.type ? branch : { ...s, ...branch, oneOf: undefined };

        return sample(merged, field);
    }
    if (s.allOf) return Object.assign({}, ...s.allOf.map((part) => sample(part, field)));
    if (s.enum) return s.enum[0];
    if (s.default !== undefined) return s.default;

    switch (s.type) {
        case 'object': {
            const keys = Object.keys(s.properties ?? {});
            const required = s.required?.length
                ? s.required
                : [['description', 'name', keys[0]].find((k) => keys.includes(k))].filter(Boolean);
            const out = {};
            for (const key of required) out[key] = sample(s.properties?.[key], key);
            return out;
        }
        case 'array':
            return [];
        case 'integer':
        case 'number':
            if (/Cents$/.test(field)) return 10000;
            return s.minimum ?? 1;
        case 'boolean':
            return false;
        default:
            break;
    }

    if (s.format === 'uuid') return `{{${variableForField(field)}}}`;
    if (s.format === 'date') return '{{today}}';
    if (s.format === 'date-time') return '{{$isoTimestamp}}';
    if (s.pattern === '^\\d{4}-(0[1-9]|1[0-2])$') return '{{currentMonth}}';
    const digits = s.pattern?.match(/^\^\[0-9\]\{(\d+)\}\$$/);
    if (digits) return '9'.repeat(Number(digits[1]));

    return field ? `Exemplo ${field}` : 'Exemplo';
};

const queryValue = (param) => {
    const value = sample(param.schema, param.name);

    return typeof value === 'string' ? value : JSON.stringify(value);
};

const describeOptional = (schema) => {
    const s = deref(schema);
    const optional = Object.keys(s?.properties ?? {}).filter((k) => !s.required?.includes(k));

    return optional.length
        ? `\n\nCampos opcionais do corpo: ${optional.map((k) => `\`${k}\``).join(', ')}.`
        : '';
};

/** Depois de um `POST` que cria, guarda `data.id` na variável do recurso. */
const captureScript = (variable) => ({
    listen: 'test',
    script: {
        type: 'text/javascript',
        exec: [
            'if (pm.response.code === 201) {',
            '    const id = pm.response.json()?.data?.id;',
            `    if (id) pm.environment.set('${variable}', id);`,
            '}',
        ],
    },
});

const toItem = ({ route, method, op, params }) => {
    const segments = route.split('/').filter(Boolean);
    const pathParams = params.filter((p) => p.in === 'path');
    const queryParams = params.filter((p) => p.in === 'query');
    const body = deref(op.requestBody)?.content?.['application/json']?.schema;

    const url = {
        raw: '',
        host: ['{{baseUrl}}'],
        path: segments.map((s) => s.replace(/^\{(\w+)\}$/, ':$1')),
    };

    if (queryParams.length) {
        url.query = queryParams.map((p) => ({
            key: p.name,
            value: queryValue(p),
            description: (p.description ?? '').trim() || undefined,
            disabled: p.required ? undefined : true,
        }));
    }

    if (pathParams.length) {
        url.variable = pathParams.map((p) => ({
            key: p.name,
            value: `{{${idVariableFor(segments, p.name)}}}`,
        }));
    }

    const query = (url.query ?? [])
        .filter((q) => !q.disabled)
        .map((q) => `${q.key}=${q.value}`)
        .join('&');
    url.raw = `{{baseUrl}}/${url.path.join('/')}${query ? `?${query}` : ''}`;

    const request = {
        method: method.toUpperCase(),
        header: body ? [{ key: 'Content-Type', value: 'application/json' }] : [],
        url,
        description:
            `${(op.description ?? op.summary ?? '').trim()}${describeOptional(body)}`.trim() ||
            undefined,
    };

    if (!op.security) request.auth = { type: 'noauth' };

    if (body) {
        request.body = {
            mode: 'raw',
            raw: JSON.stringify(sample(body), null, 4),
            options: { raw: { language: 'json' } },
        };
    }

    const item = { name: op.summary ?? `${method.toUpperCase()} ${route}`, request };
    const last = segments.at(-1);

    if (method === 'post' && !last.startsWith('{') && last !== 'archive') {
        item.event = [captureScript(`${camel(singular(last))}Id`)];
    }

    return item;
};

/**
 * Pré-requisição da collection: datas de conveniência e o ID token do Firebase.
 * O token é obtido por email e senha (`signInWithPassword`) e reaproveitado até
 * um minuto antes de expirar.
 */
const PRE_REQUEST = [
    "const zone = 'America/Sao_Paulo';",
    "const today = new Date().toLocaleDateString('en-CA', { timeZone: zone });",
    "pm.environment.set('today', today);",
    "pm.environment.set('currentMonth', today.slice(0, 7));",
    '',
    "if (pm.request.auth && pm.request.auth.type === 'noauth') return;",
    '',
    "const apiKey = pm.environment.get('firebaseApiKey');",
    "const email = pm.environment.get('email');",
    "const password = pm.environment.get('password');",
    "const expiresAt = Number(pm.environment.get('idTokenExpiresAt') || 0);",
    '',
    "if (pm.environment.get('idToken') && Date.now() < expiresAt - 60000) return;",
    '',
    'if (!apiKey || !email || !password) {',
    "    console.warn('Preencha firebaseApiKey, email e password no ambiente para obter o token.');",
    '    return;',
    '}',
    '',
    'pm.sendRequest(',
    '    {',
    '        url: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,',
    "        method: 'POST',",
    "        header: { 'Content-Type': 'application/json' },",
    "        body: { mode: 'raw', raw: JSON.stringify({ email, password, returnSecureToken: true }) },",
    '    },',
    '    (err, res) => {',
    '        if (err || res.code !== 200) {',
    "            console.error('Falha ao obter o ID token do Firebase', err || res.json());",
    '            return;',
    '        }',
    '',
    '        const { idToken, expiresIn } = res.json();',
    "        pm.environment.set('idToken', idToken);",
    "        pm.environment.set('idTokenExpiresAt', String(Date.now() + Number(expiresIn) * 1000));",
    '    },',
    ');',
];

const tags = (doc.tags ?? []).map((t) => t.name);
const folders = tags.map((tag) => ({
    name: tag,
    description: (doc.tags.find((t) => t.name === tag)?.description ?? '').trim() || undefined,
    item: operations.filter(({ op }) => (op.tags?.[0] ?? '') === tag).map(toItem),
}));

const untagged = operations.filter(({ op }) => !tags.includes(op.tags?.[0]));
if (untagged.length)
    throw new Error(`operações sem tag conhecida: ${untagged.map((o) => o.route)}`);

const collection = {
    info: {
        name: doc.info.title,
        description:
            'Gerada de `docs/openapi.yaml` por `npm run postman`. Não edite à mão: mude o contrato e regere. Uso em `docs/postman/README.md`.',
        schema: COLLECTION_SCHEMA,
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{idToken}}', type: 'string' }] },
    event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: PRE_REQUEST } }],
    item: folders.filter((f) => f.item.length),
};

const environment = ({ name, server }) => ({
    name,
    values: [
        { key: 'baseUrl', value: server, type: 'default', enabled: true },
        { key: 'firebaseApiKey', value: '', type: 'secret', enabled: true },
        { key: 'email', value: '', type: 'default', enabled: true },
        { key: 'password', value: '', type: 'secret', enabled: true },
        { key: 'idToken', value: '', type: 'secret', enabled: true },
        { key: 'idTokenExpiresAt', value: '', type: 'default', enabled: true },
        { key: 'today', value: '', type: 'default', enabled: true },
        { key: 'currentMonth', value: '', type: 'default', enabled: true },
        ...[...new Set([...idVariables, ...usedVariables])]
            .sort()
            .map((key) => ({ key, value: '', type: 'default', enabled: true })),
    ],
});

const servers = (doc.servers ?? []).map((s) => s.url);
for (const env of ENVIRONMENTS) {
    if (!servers.includes(env.server)) {
        throw new Error(`servidor ${env.server} não está em servers do openapi.yaml`);
    }
}

const prettierOptions = { ...(await prettier.resolveConfig(OPENAPI)), parser: 'json' };
const render = (data) => prettier.format(JSON.stringify(data), prettierOptions);

const outputs = [
    ['finances-control.postman_collection.json', collection],
    ...ENVIRONMENTS.map((env) => [`${env.file}.postman_environment.json`, environment(env)]),
];

const check = process.argv.includes('--check');
const stale = [];

for (const [file, data] of outputs) {
    const path = resolve(OUT_DIR, file);
    const content = await render(data);

    if (check) {
        if (!existsSync(path) || readFileSync(path, 'utf8') !== content) stale.push(file);
    } else {
        mkdirSync(OUT_DIR, { recursive: true });
        writeFileSync(path, content);
    }
}

if (stale.length) {
    console.error(`docs/postman defasado em relação ao openapi.yaml: ${stale.join(', ')}`);
    console.error('Rode `npm run postman` e commite o resultado.');
    process.exit(1);
}

console.log(
    check ? 'docs/postman em dia.' : `docs/postman gerado (${operations.length} operações).`,
);
