// Gate `boundaries` (spec 0002) — enforcement das regras 1 a 3 e 5 do ADR-0003.
// As regras já valem para os módulos de domínio que ainda vão nascer: o gate
// existe antes deles justamente para que a fronteira não seja negociada depois.

const DOMAIN = 'identity|accounts|expenses|statements|earnings|reporting|imports';

/**
 * Módulos autorizados a chamar a interface pública do `accounts` (spec 0002, `boundaries`):
 * invariantes de saldo e limite e a derivação de ciclo vivem no módulo dono do número.
 */
const ACCOUNTS_API_CLIENTS = 'expenses|statements|earnings';

/** Clientes que só podem chamar o `accounts`; `statements` também lê o `expenses` (spec 0013). */
const ACCOUNTS_ONLY_CLIENTS = 'expenses|earnings';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        {
            name: 'no-circular',
            severity: 'error',
            comment: 'Dependência circular indica fronteira mal colocada.',
            from: {},
            to: { circular: true },
        },
        {
            name: 'platform-must-not-depend-on-domain',
            severity: 'error',
            comment:
                'ADR-0003: `platform` é infraestrutura transversal. Se ela precisa de um módulo ' +
                'de domínio, a dependência está invertida — use uma interface ou um evento.',
            from: { path: '^src/platform/' },
            to: { path: `^src/(${DOMAIN})/` },
        },
        {
            name: 'no-deep-import-across-modules',
            severity: 'error',
            comment:
                'ADR-0003 regra 1: um módulo só é acessado pela sua interface pública ' +
                '(`index.ts`). Importar arquivo interno de outro módulo é proibido.',
            // A referência ao grupo capturado precisa ser numerada ($1): o
            // dependency-cruiser não substitui grupos nomeados no pathNot.
            from: { path: '^src/([^/]+)/' },
            to: {
                path: '^src/[^/]+/.+',
                pathNot: ['^src/$1/', '^src/[^/]+/index\\.ts$'],
            },
        },
        {
            name: 'no-cross-domain-dependency',
            severity: 'error',
            comment:
                'ADR-0003 regras 2 e 3: módulos de domínio não dependem uns dos outros. ' +
                'Efeitos entre contextos viajam como evento de domínio. `reporting` é a ' +
                'única exceção (regra 5), e apenas para leitura.',
            from: {
                path: `^src/(${DOMAIN})/`,
                pathNot: ['^src/reporting/', `^src/(?:${ACCOUNTS_API_CLIENTS})/`],
            },
            to: {
                path: `^src/(?:${DOMAIN})/`,
                pathNot: '^src/$1/',
            },
        },
        {
            name: 'only-accounts-public-api-across-domain',
            severity: 'error',
            comment:
                'ADR-0003 regra 4 e INV-0004-03: invariante financeira entre módulos é chamada ' +
                'síncrona à interface pública do módulo dono do número, nunca evento. ' +
                '`expenses` (spec 0012, INV-0012-10), `statements` (spec 0013, `cycleFor`) e ' +
                '`earnings` (spec 0014, INV-0014-06) podem importar `src/accounts/index.ts` e ' +
                'nenhum outro módulo de domínio, salvo a regra seguinte para `statements`.',
            from: { path: `^src/(${ACCOUNTS_ONLY_CLIENTS})/` },
            to: {
                path: `^src/(?:${DOMAIN})/`,
                pathNot: ['^src/$1/', '^src/accounts/index\\.ts$'],
            },
        },
        {
            name: 'statements-reads-accounts-and-expenses-public-api',
            severity: 'error',
            comment:
                'Spec 0013 (INV-0013-12): `statements` lê e quita despesas de cartão pela ' +
                'interface pública do `expenses` (`listByCreditCard`, `markPaidByStatement`) e ' +
                'deriva ciclos e move saldo e limite pela do `accounts`. Nenhum outro módulo ' +
                'de domínio; `expenses` nunca importa `statements` (regra `no-cross-domain-dependency`).',
            from: { path: '^src/(statements)/' },
            to: {
                path: `^src/(?:${DOMAIN})/`,
                pathNot: ['^src/$1/', '^src/accounts/index\\.ts$', '^src/expenses/index\\.ts$'],
            },
        },
        {
            name: 'firebase-admin-only-in-its-adapter',
            severity: 'error',
            comment:
                'INV-0010-07: `firebase-admin` é detalhe de um adaptador. Espalhá-lo pelo código ' +
                'tornaria autenticação e autorização intestáveis sem rede e sem projeto Firebase. ' +
                'Quem precisa verificar um token depende da porta `TokenVerifier`.',
            from: { pathNot: '^src/identity/firebase-token-verifier\\.ts$' },
            to: { path: '(^|/)node_modules/firebase-admin/' },
        },
        {
            name: 'events-catalog-only-imports-platform',
            severity: 'error',
            comment:
                'INV-0004-07: `src/events/` contém apenas tipos e constantes e importa só de ' +
                '`src/platform`. Importar de módulo de domínio reabriria o acoplamento que o ' +
                'catálogo existe para evitar.',
            from: { path: '^src/events/' },
            to: { path: `^src/(${DOMAIN})/` },
        },
        {
            name: 'platform-must-not-depend-on-events-catalog',
            severity: 'error',
            comment:
                'INV-0004-07 e INV-0004-10: `platform` não conhece os eventos que existem; o ' +
                'dispatcher é agnóstico e os handlers são registrados pela composição em `src/`.',
            from: { path: '^src/platform/' },
            to: { path: '^src/events/' },
        },
        {
            name: 'pg-boss-only-in-platform-jobs',
            severity: 'error',
            comment:
                'INV-0017-03: `pg-boss` é detalhe do adaptador de jobs. Quem precisa de um job ' +
                'depende da porta `JobQueue` e do `JobQueueSymbol`.',
            from: { pathNot: '^src/platform/jobs/' },
            to: { path: '(^|/)node_modules/pg-boss/' },
        },
        {
            name: 'no-orphans',
            severity: 'warn',
            comment: 'Arquivo que ninguém importa costuma ser resto de refatoração.',
            from: {
                orphan: true,
                pathNot: ['^src/server\\.ts$', '\\.d\\.ts$'],
            },
            to: {},
        },
    ],
    options: {
        doNotFollow: { path: 'node_modules' },
        exclude: { path: '\\.spec\\.ts$' },
        tsConfig: { fileName: 'tsconfig.json' },
        tsPreCompilationDeps: true,
        reporterOptions: {
            text: { highlightFocused: true },
        },
    },
};
