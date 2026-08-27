// Gate `boundaries` (spec 0002) — enforcement das regras 1 a 3 e 5 do ADR-0003.
// As regras já valem para os módulos de domínio que ainda vão nascer: o gate
// existe antes deles justamente para que a fronteira não seja negociada depois.

const DOMAIN = 'identity|accounts|expenses|statements|earnings|reporting|imports';

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
                pathNot: '^src/reporting/',
            },
            to: {
                path: `^src/(?:${DOMAIN})/`,
                pathNot: '^src/$1/',
            },
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
