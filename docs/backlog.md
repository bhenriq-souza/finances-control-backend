# Backlog

Fila de trabalho deste repositório. Formato e regras em [spec 0000](../specs/0000-spec-process.md): cada tarefa é `T-<spec>-<nn>` e declara **What** / **Where** / **Done when**, citando ao menos um `AC-*` ou `INV-*`.

Este arquivo é a camada de **execução**. A camada de **entrega** são as issues `FCB-*` e o [board](https://github.com/users/bhenriq-souza/projects/2) — o PR que conclui a última tarefa de uma spec fecha também a issue correspondente.

## Plataforma e processo

- [x] **T-0001-01 — Tornar o status check `check` obrigatório em `develop`**
    - What: concluída a ativação faseada, exigir o check verde para merge (regra 3 da proteção de branch)
    - Where: configurações do repositório no GitHub
    - Done when: `AC-0001-03` verificado — a proteção lista `check` como obrigatório e um PR vermelho fica bloqueado
- [ ] **T-0002-01 — Testes do orquestrador de gates**
    - What: cobrir `scripts/check.mjs` — classificação PASS/FAIL/SKIP, código de saída e modo `--require-tools`
    - Where: `tests/unit/scripts/check.spec.ts`
    - Done when: `AC-0002-01`, `AC-0002-02` e `AC-0002-03` cobertos por teste automatizado
- [x] **T-0002-02 — Hook `commit-msg` com commitlint**
    - What: instalar husky + commitlint para reprovar mensagens fora de Conventional Commits e sem o rodapé `Task:`
    - Where: `.husky/commit-msg`, `commitlint.config.js`
    - Done when: `INV-0001-02` passa a ser verificado localmente; uma mensagem inválida é rejeitada sem `--no-verify`
- [x] **T-0002-03 — Completar os gates e ligar o modo estrito no CI**
    - What: com o scaffold pronto, garantir que todos os gates da spec 0002 executem de fato e passar o CI a `npm run check -- --require-tools`
    - Where: `package.json`, `.dependency-cruiser.cjs`, `.github/workflows/ci.yml`
    - Done when: `AC-0002-04` e `INV-0002-05` — nenhum gate aparece como SKIP na execução do CI

## Persistência

Tarefas da [spec 0003](../specs/0003-persistence.md), que fecha a issue de entrega
[FCB-006](https://github.com/bhenriq-souza/finances-control-backend/issues/6) (Fase 1 do roadmap).
Ordem por dependência: as três primeiras são deste repositório, a última é infraestrutura.

- [x] **T-0003-01 — Conexão, convenções e transformer monetário**
    - What: `typeorm` e `pg` como dependências de runtime, `AppDataSource` em
      `src/platform/database/` registrado no container, variáveis `DATABASE_*` no `env.list`,
      `SnakeCaseNamingStrategy` e `moneyTransformer`
    - Where: `src/platform/database/`, `src/platform/config/env.list.ts`, `src/platform/symbols/index.ts`, `src/platform/index.ts`, `src/container.ts`, `package.json`
    - Done when: `AC-0003-03` e `AC-0003-05` cobertos por teste; `INV-0003-01`, `INV-0003-02` e `INV-0003-05` verificados
- [x] **T-0003-02 — Migration inicial e banco real nos testes**
    - What: scripts `migration:*`, migration `InitialBaseline` com a função `set_updated_at()`,
      `docker-compose.test.yml`, `services: postgres` no job `check` do CI e as primeiras suítes de
      integração
    - Where: `src/platform/database/migrations/`, `package.json`, `docker-compose.test.yml`, `.github/workflows/ci.yml`, `tests/integration/`
    - Done when: `AC-0003-01`, `AC-0003-02` e `AC-0003-06` verdes no CI, sem gate em SKIP
- [x] **T-0003-03 — Readiness com verificação de banco**
    - What: `GET /health/ready` na `HealthRoutes` existente, mantendo `GET /health` como liveness
      puro, e o endpoint documentado no `openapi.yaml`
    - Where: `src/platform/health/`, `docs/openapi.yaml`
    - Done when: `AC-0003-04` coberto por teste e `INV-0003-06` preservado
- [x] **T-0003-04 — Provisionamento do banco, do secret e do initContainer**
    - What: database `finances_dev` e role `finances_app` por script idempotente, secrets
      `homelab-dev-finances-database-*` no GCP Secret Manager, `ExternalSecret`, initContainer de
      migration e `readinessProbe` apontando para `/health/ready`
    - Where: GCP Secret Manager e `homelab-gitops` (`clusters/homelab/workloads/dev/manifests/finances-backend/`); evidência colada no PR deste repositório
    - Done when: `AC-0003-07` e `AC-0003-08` verificados no cluster, com `INV-0003-04` e `INV-0003-07` respeitados; fecha FCB-006

## Identity (F001)

Tarefas da [spec 0010](../specs/0010-identity.md), que fecha a issue de entrega
[FCB-007](https://github.com/bhenriq-souza/finances-control-backend/issues/7). Ordem por dependência:
o token antes do usuário, o usuário antes do RBAC, o RBAC antes dos endpoints.

- [x] **T-0010-01 — Tabela `users` e migration**
    - What: entidade `User` no módulo `identity`, com o perfil como `text` sob CHECK, e a migration
      correspondente com as constraints nomeadas pela convenção da spec 0003
    - Where: `src/identity/user.entity.ts`, `src/platform/database/migrations/`
    - Done when: `AC-0010-11` coberto; `INV-0010-08` verificado; migration aplica e reverte num banco limpo
- [x] **T-0010-02 — Porta `TokenVerifier` e adaptador Firebase**
    - What: `firebase-admin` como dependência de runtime, a porta com `verify`, o adaptador que a
      implementa, as variáveis `FIREBASE_*` no `env.list` e a regra de fronteira que isola o pacote
    - Where: `src/identity/`, `src/platform/config/env.list.ts`, `.dependency-cruiser.cjs`
    - Done when: `AC-0010-12` verde no gate `boundaries`; `INV-0010-07` verificado
- [x] **T-0010-03 — Provisionamento no primeiro acesso e bootstrap do Admin**
    - What: serviço que cria ou atualiza o usuário a partir do token verificado, numa transação, com
      a promoção idempotente do email de bootstrap
    - Where: `src/identity/`, `src/platform/config/env.list.ts`
    - Done when: `AC-0010-02`, `AC-0010-03` e `AC-0010-04` cobertos; `INV-0010-04` verificado
- [x] **T-0010-04 — Middlewares de autenticação e de perfil**
    - What: `requireAuthentication` e `requireProfile`, o usuário no `RequestStore` da plataforma e os
      erros próprios de token e de perfil pendente
    - Where: `src/identity/`, `src/platform/context/request-context.ts`, `src/platform/index.ts`
    - Done when: `AC-0010-01`, `AC-0010-05` e `AC-0010-08` cobertos; `INV-0010-01`, `INV-0010-02`,
      `INV-0010-03` e `INV-0010-09` verificados
- [x] **T-0010-05 — Endpoints de usuário e concessão de perfil**
    - What: as quatro rotas de `/users`, com as guardas de perfil próprio e de último Admin, e o
      contrato no `openapi.yaml`
    - Where: `src/identity/`, `src/platform/config/api.config.ts`, `docs/openapi.yaml`
    - Done when: `AC-0010-06`, `AC-0010-07`, `AC-0010-09` e `AC-0010-10` cobertos; `INV-0010-05` e
      `INV-0010-06` verificados
- [x] **T-0010-06 — Secrets do Firebase no cluster**
    - What: service account do `firebase-admin` e email do Admin de bootstrap no GCP Secret Manager,
      entregues por ExternalSecret, e as variáveis no deployment
    - Where: GCP Secret Manager e `homelab-gitops`; evidência colada no PR deste repositório
    - Done when: a aplicação em `dev` autentica uma requisição real e `GET /users/me` responde,
      respeitando `INV-0003-07`; por ser a última tarefa da spec, fecha FCB-007 e muda o `status` da
      spec 0010 para `implemented`

## Domínio

As specs de domínio restantes (`0011`+) ainda não foram escritas. Cada uma nasce pela skill `/new-spec` a partir da issue de entrega correspondente, e traz suas próprias tarefas para este arquivo:

| Issue   | Spec prevista     | Requisito                       |
| ------- | ----------------- | ------------------------------- |
| FCB-008 | `0011` accounts   | F002 — bancos, contas e cartões |
| FCB-009 | `0012` expenses   | F003 — despesas                 |
| FCB-010 | `0013` statements | F004 — faturas                  |
| FCB-011 | `0014` earnings   | F005 — receitas                 |
| FCB-012 | `0015` reporting  | saldo previsto e relatórios     |
| FCB-013 | `0016` imports    | importação CSV                  |
