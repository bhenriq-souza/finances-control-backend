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

- [ ] **T-0003-01 — Conexão, convenções e transformer monetário**
    - What: `typeorm` e `pg` como dependências de runtime, `AppDataSource` em
      `src/platform/database/` registrado no container, variáveis `DATABASE_*` no `env.list`,
      `SnakeCaseNamingStrategy` e `moneyTransformer`
    - Where: `src/platform/database/`, `src/platform/config/env.list.ts`, `src/platform/symbols/index.ts`, `src/platform/index.ts`, `src/container.ts`, `package.json`
    - Done when: `AC-0003-03` e `AC-0003-05` cobertos por teste; `INV-0003-01`, `INV-0003-02` e `INV-0003-05` verificados
- [ ] **T-0003-02 — Migration inicial e banco real nos testes**
    - What: scripts `migration:*`, migration `InitialBaseline` com a função `set_updated_at()`,
      `docker-compose.test.yml`, `services: postgres` no job `check` do CI e as primeiras suítes de
      integração
    - Where: `src/platform/database/migrations/`, `package.json`, `docker-compose.test.yml`, `.github/workflows/ci.yml`, `tests/integration/`
    - Done when: `AC-0003-01`, `AC-0003-02` e `AC-0003-06` verdes no CI, sem gate em SKIP
- [ ] **T-0003-03 — Readiness com verificação de banco**
    - What: `GET /health/ready` na `HealthRoutes` existente, mantendo `GET /health` como liveness
      puro, e o endpoint documentado no `openapi.yaml`
    - Where: `src/platform/health/`, `docs/openapi.yaml`
    - Done when: `AC-0003-04` coberto por teste e `INV-0003-06` preservado
- [ ] **T-0003-04 — Provisionamento do banco, do secret e do initContainer**
    - What: database `finances_dev` e role `finances_app` por script idempotente, secrets
      `homelab-dev-finances-database-*` no GCP Secret Manager, `ExternalSecret`, initContainer de
      migration e `readinessProbe` apontando para `/health/ready`
    - Where: GCP Secret Manager e `homelab-gitops` (`clusters/homelab/workloads/dev/manifests/finances-backend/`); evidência colada no PR deste repositório
    - Done when: `AC-0003-07` e `AC-0003-08` verificados no cluster, com `INV-0003-04` e `INV-0003-07` respeitados; fecha FCB-006

## Domínio

As specs de domínio (`0010`+) ainda não foram escritas. Cada uma nasce pela skill `/new-spec` a partir da issue de entrega correspondente, e traz suas próprias tarefas para este arquivo:

| Issue   | Spec prevista     | Requisito                       |
| ------- | ----------------- | ------------------------------- |
| FCB-007 | `0010` identity   | F001 — usuários e autenticação  |
| FCB-008 | `0011` accounts   | F002 — bancos, contas e cartões |
| FCB-009 | `0012` expenses   | F003 — despesas                 |
| FCB-010 | `0013` statements | F004 — faturas                  |
| FCB-011 | `0014` earnings   | F005 — receitas                 |
| FCB-012 | `0015` reporting  | saldo previsto e relatórios     |
| FCB-013 | `0016` imports    | importação CSV                  |
