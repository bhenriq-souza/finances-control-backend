---
id: '0003'
title: Persistência — PostgreSQL, TypeORM e migrations
status: approved
depends_on: ['0000', '0002']
---

# 0003 — Persistência

## Goal

Estabelecer o acesso a dados do backend: uma conexão única e injetável com o PostgreSQL do cluster,
migrations versionadas como **único** meio de evoluir o schema, convenções de schema que valem para
todos os módulos, a representação monetária na fronteira do banco e um readiness que distingue
aplicação viva de aplicação pronta. Ao final, uma spec de domínio (`0010`+) só precisa declarar suas
entidades, seus repositórios e suas migrations — sem reabrir nenhuma decisão de infraestrutura.

## Scope / Non-goals

- **Em escopo:** dependências de persistência; o `DataSource` único e seu registro no container;
  variáveis de conexão; convenções de schema e de nomes; formato, geração e execução de migrations;
  a migration inicial; o transformer monetário; `GET /health/ready`; a estratégia de teste com banco
  real; o provisionamento do database dedicado, do role e do secret.
- **Fora de escopo:** entidades e tabelas de domínio, que pertencem às specs `0010`+; trabalho
  assíncrono com `pg-boss` (FCB-015) e o dispatcher de eventos (FCB-014), ambos do
  [ADR-0005](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0005-queue.md);
  backup, restore e promoção para `prd` (roadmap, Fase 4); pooling externo (PgBouncer) e réplicas de
  leitura.

## Contracts

### Dependências

`typeorm` e `pg` entram como **dependências de runtime**, não de desenvolvimento: o Dockerfile roda
`npm ci --omit=dev` e o initContainer de migration executa a CLI do TypeORM a partir da mesma imagem.

### Variáveis de ambiente

Declaradas em `src/platform/config/env.list.ts` e validadas no boot pelo `EnvService`:

| Chave               | Obrigatória | Default | Descrição                                         |
| ------------------- | ----------- | ------- | ------------------------------------------------- |
| `DATABASE_URL`      | sim         | —       | `postgres://<user>:<pass>@<host>:5432/<database>` |
| `DATABASE_SSL`      | não         | `false` | TLS na conexão; `false` dentro do cluster         |
| `DATABASE_POOL_MAX` | não         | `10`    | Conexões máximas do pool                          |

Não existe variável que aplique migrations no boot: a execução é sempre explícita (INV-0003-04).

### Conexão

- `src/platform/database/data-source.ts` exporta `AppDataSource: DataSource`, construído a partir das
  variáveis acima, com `synchronize: false`, `migrationsRun: false`, `namingStrategy:
SnakeCaseNamingStrategy` e `entities` resolvidas por glob de `src/*/**/*.entity.{ts,js}`.
- O container registra `DatabaseConnectionSymbol` (novo símbolo em `src/platform/symbols/index.ts`)
  como singleton apontando para `AppDataSource`. Nenhum módulo instancia `DataSource` próprio.
- `src/platform/index.ts` reexporta `AppDataSource`, `DatabaseConnectionSymbol` e `moneyTransformer`
  — módulos de domínio importam daqui, nunca de caminho interno da plataforma.
- O arquivo compilado `dist/src/platform/database/data-source.js` é o alvo `-d` da CLI do TypeORM em
  imagem; em desenvolvimento, o alvo é o `.ts` equivalente.

### Convenções de schema (normativas para as specs `0010`+)

- Tabelas em `snake_case` plural (`bank_accounts`); colunas em `snake_case`. A conversão
  camelCase → snake_case é feita por `SnakeCaseNamingStrategy`, implementada localmente em
  `src/platform/database/snake-case.naming-strategy.ts` — sem dependência externa para isso.
- Chave primária: `id uuid primary key default gen_random_uuid()` (nativo no PostgreSQL 16).
- Toda tabela tem `created_at` e `updated_at` `timestamptz not null default now()`. O `updated_at` é
  mantido pelo trigger `set_updated_at()` do banco, não por `@UpdateDateColumn` — assim o valor vale
  também para escrita fora do ORM (importação CSV, correção manual, migration).
- Colunas de data/hora são sempre `timestamptz`, gravadas em UTC. Data sem hora (competência,
  vencimento) é `date`.
- Valores monetários são `numeric(14,2)`; nunca `real`, `double precision` ou `money`.
- Chaves estrangeiras usam `on delete restrict`, salvo justificativa na spec do módulo.
- Nomes de objeto: `pk_<tabela>`, `fk_<tabela>_<referência>`, `uq_<tabela>_<colunas>`,
  `idx_<tabela>_<colunas>`, `ck_<tabela>_<regra>`.

### Migrations

- Arquivos em `src/platform/database/migrations/<timestamp>-<NomeEmPascalCase>.ts`, classes que
  implementam `MigrationInterface` com `up` **e** `down`.
- Geradas por `npm run migration:generate -- <Nome>` e revisadas à mão antes do commit; uma migration
  já mergeada em `develop` nunca é editada — o ajuste vira uma migration nova.
- Scripts em `package.json`: `migration:generate`, `migration:run`, `migration:revert`,
  `migration:show`.
- **Migration inicial** (`InitialBaseline`): cria a função `set_updated_at()` usada pelos triggers de
  todas as tabelas futuras. Não cria tabela de domínio — o schema de negócio nasce fatia a fatia nas
  specs `0010`+, junto das entidades que o justificam. A tabela de controle `migrations` é criada
  pelo próprio TypeORM.

### Representação monetária

`src/platform/database/money.transformer.ts` exporta `moneyTransformer: ValueTransformer`, único
ponto de conversão entre banco e aplicação
([ADR-0007](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0007-monetary-representation.md)):

- `to(cents: number | null): string | null` — recebe inteiro de centavos e devolve a string decimal
  com exatamente duas casas que o driver grava em `numeric`.
- `from(value: string | null): number | null` — recebe a string devolvida pelo driver `pg` e devolve
  inteiro de centavos, por manipulação de dígitos, sem passar por ponto flutuante.
- O parser de `numeric` do `pg` **não** é sobrescrito para retornar `number`: a string é a entrada
  esperada por `from`.

### Readiness

- `GET /health` permanece liveness puro: não toca no banco, mantém o contrato atual de `HealthReport`.
- `GET /health/ready` é adicionado à mesma `HealthRoutes` (path `/ready`):
    - pronto → `200` com envelope `ok`: `{ data: { status: 'ready', checks: { database: 'up' } } }`;
    - não pronto → `503` com envelope `fail`: código `NOT_READY`, `details.checks.database = 'down'`.
- A verificação é `SELECT 1` com timeout de 2 segundos, sem cache entre requisições.
- O `readinessProbe` do deployment passa a apontar para `/health/ready`; o `livenessProbe` continua
  em `/health`.
- O endpoint é documentado em `docs/openapi.yaml` na tag `Platform`.

### Execução das migrations no deploy

Decidido no [ADR local 0001](adr/0001-migration-execution.md): initContainer `migrations`, na mesma
imagem do app e com as mesmas variáveis, executando `typeorm migration:run` contra
`dist/src/platform/database/data-source.js`. A aplicação nunca aplica migration sozinha.

### Provisionamento (fora deste repositório)

- Database dedicado `finances_dev` e role `finances_app`, proprietário do database, na instância
  PostgreSQL 16 de `dev-apps` — hoje com o database `homelab_ai` e o user `appuser`. A criação é
  feita por script idempotente, versionado no `homelab-gitops`, nunca por `psql` manual e não
  reproduzível.
- Secrets no GCP Secret Manager, seguindo a convenção `homelab-dev-finances-*`:
  `homelab-dev-finances-database-password` e `homelab-dev-finances-database-url`.
- `ExternalSecret` `finances-backend-database` no namespace `dev-apps`, `ClusterSecretStore`
  `gcp-sm-dev`, gerando o secret consumido pelo deployment com a chave `DATABASE_URL`.
- O pod já carrega a label `homelab.io/database-access: postgresql`, exigida pela NetworkPolicy do
  PostgreSQL — nenhuma mudança de rede é necessária.

### Testes com banco real

- Testes de integração vivem em `tests/integration/**`, exigem `DATABASE_URL` e falham com mensagem
  acionável quando ela não existe. Testes de unidade não tocam no banco.
- No CI, o job `check` ganha um `services: postgres` (`postgres:16-alpine`) e exporta `DATABASE_URL`
  apontando para ele. O comando do gate `test` continua sendo `npx jest --coverage` — a spec 0002 não
  muda.
- Localmente, `docker-compose.test.yml` na raiz sobe o mesmo PostgreSQL, com `npm run db:up` e
  `npm run db:down`.
- Cada suíte de integração aplica as migrations num banco limpo e as reverte ao final.

## Invariants

- **INV-0003-01:** existe um único `DataSource` na aplicação, criado em `src/platform/database/` e
  resolvido por injeção; nenhum módulo abre conexão própria.
- **INV-0003-02:** `synchronize` é sempre `false` — o schema só muda por migration versionada.
- **INV-0003-03:** toda migration tem `up` e `down`, e uma migration já mergeada nunca é editada.
- **INV-0003-04:** a aplicação não aplica migrations no boot; a execução é do initContainer, ou de
  comando explícito em ambiente local e de teste.
- **INV-0003-05:** colunas monetárias são `numeric(14,2)` e atravessam a fronteira do ORM como
  inteiro de centavos, sempre via `moneyTransformer` (INV-0000-04, ADR-0007).
- **INV-0003-06:** `GET /health` não toca em dependência externa; a verificação de banco existe
  apenas em `GET /health/ready`.
- **INV-0003-07:** credenciais de banco vêm do ambiente (`DATABASE_URL`, entregue pelo ESO em
  cluster) e nunca são versionadas, nem em código, nem em manifesto, nem em teste.
- **INV-0003-08:** toda coluna de data e hora é `timestamptz` gravada em UTC.
- **INV-0003-09:** `platform` não conhece entidade de domínio; módulos de domínio acessam o banco
  apenas por repositórios do próprio módulo (ADR-0003, regras 1–3, verificado pelo gate
  `boundaries`).

## Error cases

| Situação                                          | Comportamento exigido                                                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **ERR-0003-01** `DATABASE_URL` ausente            | O boot falha no `EnvService`, listando a variável junto das demais faltantes; processo sai com código diferente de zero                         |
| **ERR-0003-02** Banco indisponível no boot        | A aplicação sobe: `GET /health` responde `200`, `GET /health/ready` responde `503` com `database: 'down'`, e o erro é logado com correlation id |
| **ERR-0003-03** Migration falha no deploy         | O initContainer sai com erro, o container da aplicação não inicia, o pod não fica Ready e a réplica anterior continua servindo                  |
| **ERR-0003-04** Violação de constraint em runtime | O erro do driver é traduzido para `CustomError` pela camada do módulo; a resposta HTTP nunca expõe mensagem do PostgreSQL                       |
| **ERR-0003-05** Centavos não inteiros no `to`     | `moneyTransformer.to` lança `TypeError`; nunca arredonda silenciosamente                                                                        |
| **ERR-0003-06** `numeric` com mais de duas casas  | `moneyTransformer.from` lança `TypeError` — o valor indica coluna com escala errada                                                             |

## Acceptance criteria

- **AC-0003-01:** `npm run migration:run` num banco vazio aplica a migration inicial e cria a função
  `set_updated_at`; uma segunda execução não altera nada e sai com código zero.
- **AC-0003-02:** `npm run migration:revert` desfaz a última migration aplicada, deixando o banco no
  estado anterior.
- **AC-0003-03:** o `DataSource` resolvido pelo container é sempre a mesma instância, inicializado
  uma vez por processo.
- **AC-0003-04:** com o banco parado, `GET /health` responde `200` e `GET /health/ready` responde
  `503` com `code: 'NOT_READY'`; restabelecido o banco, `GET /health/ready` volta a `200` sem
  reiniciar o processo.
- **AC-0003-05:** `moneyTransformer` faz round-trip exato de centavos para `numeric(14,2)` e de volta,
  incluindo zero, negativos e o limite superior da escala, sem uso de ponto flutuante.
- **AC-0003-06:** o job `check` do CI sobe o serviço PostgreSQL e executa os testes de integração
  contra ele, sem nenhum gate em SKIP (`--require-tools`).
- **AC-0003-07:** o deployment em `dev-apps` tem o initContainer de migration, e o pod só fica Ready
  depois de as migrations serem aplicadas.
- **AC-0003-08:** a aplicação em `dev` conecta usando a credencial entregue pelo `ExternalSecret`, e
  `GET http://finances.dev.homelab.local/health/ready` responde `200` com `database: 'up'`.

## Test mapping

| Item                                              | Teste                                                                                                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| AC-0003-01, AC-0003-02, INV-0003-02, INV-0003-03  | `tests/integration/platform/database/migrations.spec.ts`                                                        |
| AC-0003-03, INV-0003-01                           | `tests/platform/database/data-source.spec.ts`                                                                   |
| AC-0003-04, INV-0003-06, ERR-0003-02              | `tests/platform/health/health.controller.spec.ts` (unidade) e `tests/integration/platform/health/ready.spec.ts` |
| AC-0003-05, INV-0003-05, ERR-0003-05, ERR-0003-06 | `tests/platform/database/money.transformer.spec.ts`                                                             |
| Convenções de nome de coluna                      | `tests/platform/database/snake-case.naming-strategy.spec.ts`                                                    |
| AC-0003-06                                        | execução do workflow `ci` no PR de T-0003-02                                                                    |
| AC-0003-07, AC-0003-08, INV-0003-04               | verificação manual no cluster, com saída colada no PR de T-0003-04                                              |
| INV-0003-07, INV-0003-08                          | revisão de PR                                                                                                   |
| INV-0003-09                                       | gate `boundaries`                                                                                               |
| ERR-0003-01                                       | `tests/platform/config/env.list.spec.ts`                                                                        |
| ERR-0003-03                                       | verificação manual no cluster, registrada no PR de T-0003-04                                                    |
| ERR-0003-04                                       | testes das specs `0010`+, no módulo que declara a constraint                                                    |

## Open questions

Nenhuma.
