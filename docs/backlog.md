# Backlog

Fila de trabalho deste repositório. Formato e regras em [spec 0000](../specs/0000-spec-process.md): cada tarefa é `T-<spec>-<nn>` e declara **What** / **Where** / **Done when**, citando ao menos um `AC-*` ou `INV-*`.

Este arquivo é a camada de **execução**. A camada de **entrega** são as issues `FCB-*` e o [board](https://github.com/users/bhenriq-souza/projects/2). Cada tarefa aberta tem também a sua issue no board, sub-issue da `FCB-*` da spec, com o número anotado ao lado do título (`· #N`); o PR da tarefa fecha a issue dela, e o PR da última tarefa de uma spec fecha também a `FCB-*` (spec 0000, _Rastreabilidade com o board_).

## Plataforma e processo

- [x] **T-0001-01 — Tornar o status check `check` obrigatório em `develop`**
    - What: concluída a ativação faseada, exigir o check verde para merge (regra 3 da proteção de branch)
    - Where: configurações do repositório no GitHub
    - Done when: `AC-0001-03` verificado — a proteção lista `check` como obrigatório e um PR vermelho fica bloqueado
- [ ] **T-0002-01 — Testes do orquestrador de gates** · #70
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

## Eventos de domínio

Tarefas da [spec 0004](../specs/0004-domain-events.md), que fecha a issue de entrega
[FCB-014](https://github.com/bhenriq-souza/finances-control-backend/issues/14). Ordem por
dependência: o envelope e o dispatcher antes do escopo de transação, e os dois antes da composição.

- [ ] **T-0004-01 — Envelope do evento e dispatcher in-process** · #50
    - What: tipos `DomainEvent`, `JsonObject` e `DomainEventHandler`, a porta `DomainEventDispatcher`
      e a `InProcessDomainEventDispatcher` (inscrição idempotente, entrega em ordem, falha isolada e
      logada), com símbolos e exportações na interface pública da plataforma
    - Where: `src/platform/events/`, `src/platform/symbols/index.ts`, `src/platform/index.ts`
    - Done when: `AC-0004-01` a `AC-0004-04` cobertos; `INV-0004-04`, `INV-0004-05` e `INV-0004-09`
      verificados
- [ ] **T-0004-02 — `TransactionRunner` e publicação pós-commit** · #51
    - What: `TransactionScope` e `TransactionRunner` sobre `dataSource.transaction`, acumulando
      eventos e despachando só após o commit, descartando no rollback e fechando o escopo ao fim;
      registro dos dois singletons no container
    - Where: `src/platform/events/transaction-runner.ts`, `src/container.ts`, `tests/integration/platform/events/`
    - Done when: `AC-0004-05` a `AC-0004-09` e `AC-0004-12` cobertos; `INV-0004-01` e `INV-0004-02`
      verificados
- [ ] **T-0004-03 — Catálogo `src/events/`, subscribers na composição e regras de fronteira** · #52
    - What: `src/events/index.ts` com o contrato documentado, a interface `DomainEventSubscriber`,
      o campo `subscribers` de `ApiModule` tratado por `registerApiModules`, as duas regras novas no
      `.dependency-cruiser.cjs` e o parágrafo em `AGENTS.md` (regra 8) sobre publicar e consumir
    - Where: `src/events/`, `src/platform/api/register-api-modules.ts`, `.dependency-cruiser.cjs`, `AGENTS.md`
    - Done when: `AC-0004-10` e `AC-0004-11` cobertos; `INV-0004-07` e `INV-0004-10` verificados;
      última tarefa da spec: fecha FCB-014 e muda o `status` para `implemented`

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

## Accounts (F002)

Tarefas da [spec 0011](../specs/0011-accounts.md), que fecha a issue de entrega
[FCB-008](https://github.com/bhenriq-souza/finances-control-backend/issues/8). Ordem por
dependência: o banco antes do que se liga a ele, e o ciclo antes do cartão que o publica.

- [x] **T-0011-01 — Entidades e migration de `banks`, `bank_accounts` e `credit_cards`**
    - What: as três entidades com enum sob CHECK, colunas monetárias `numeric(14,2)` pelo
      `moneyTransformer`, e a migration com as constraints nomeadas pela convenção da spec 0003
    - Where: `src/accounts/`, `src/platform/database/migrations/`
    - Done when: `INV-0011-01` e `INV-0011-02` verificados; migration aplica e reverte num banco limpo
- [x] **T-0011-02 — Derivação do ciclo de fatura**
    - What: `cycleFor(card, reference)` com a resolução de dia inexistente no mês e o vencimento que
      cai no mês seguinte, isolado de banco e de HTTP
    - Where: `src/accounts/`
    - Done when: `AC-0011-05`, `AC-0011-06` e `AC-0011-07` cobertos; `INV-0011-08` verificado
- [x] **T-0011-03 — Cadastro e consulta de bancos**
    - What: `POST`/`GET`/`PATCH` de `/banks`, com o código FEBRABAN validado e único
    - Where: `src/accounts/`, `src/api.config.ts`
    - Done when: `AC-0011-01` e `AC-0011-02` na parte de bancos; `ERR-0011-01` e `ERR-0011-02`
- [x] **T-0011-04 — Contas bancárias**
    - What: as rotas de `/bank-accounts`, com saldo de abertura, saldo corrente somente-leitura e
      recusa de vínculo a banco arquivado
    - Where: `src/accounts/`
    - Done when: `AC-0011-01`, `AC-0011-03`, `AC-0011-08`, `AC-0011-11` e `AC-0011-13`
- [x] **T-0011-05 — Cartões de crédito**
    - What: as rotas de `/credit-cards`, com limite disponível somente-leitura e o `currentCycle`
      derivado na resposta
    - Where: `src/accounts/`
    - Done when: `AC-0011-04` e `AC-0011-08` na parte de cartões; `INV-0011-06`
- [x] **T-0011-06 — Arquivamento, autorização e OpenAPI**
    - What: arquivar e desarquivar as três entidades, o filtro `?archived=true`, as guardas de perfil
      nas rotas e o contrato no `openapi.yaml`
    - Where: `src/accounts/`, `docs/openapi.yaml`
    - Done when: `AC-0011-09`, `AC-0011-10` e `AC-0011-12` cobertos; `INV-0011-03` e `INV-0011-09`
      verificados; por ser a última tarefa da spec, fecha FCB-008 e muda o `status` para `implemented`

## Expenses (F003)

Tarefas da [spec 0012](../specs/0012-expenses.md), que fecha a issue de entrega
[FCB-009](https://github.com/bhenriq-souza/finances-control-backend/issues/9). Ordem por
dependência: schema e helper antes de tudo; o `accounts` ganha os movimentos antes de a despesa os
usar; criação antes de parcelas e de status; consulta, alteração e OpenAPI por último.

- [ ] **T-0012-01 — Entidades, migration, seed dos tipos, `splitCents` e `businessToday`** · #53
    - What: entidades com os enums sob CHECK, migration com os dez tipos, `splitCents` e
      `businessToday`/`BUSINESS_TIME_ZONE` exportados pela interface da plataforma
    - Where: `src/expenses/`, `src/platform/money.ts`, `src/platform/business-date.ts`, `src/platform/index.ts`, `src/platform/database/migrations/`
    - Done when: `AC-0012-01` e `AC-0012-20` cobertos; `INV-0012-01`, `INV-0012-02`, `INV-0012-07`
      e `INV-0012-14` verificados pelas constraints; `INV-0012-16` coberto por teste unitário
- [ ] **T-0012-02 — Tipos de despesa** · #54
    - What: as rotas de `/expense-types` com unicidade case-insensitive, arquivamento idempotente e
      guardas de perfil, registradas em `api.config.ts`
    - Where: `src/expenses/`, `src/api.config.ts`
    - Done when: `AC-0012-02` coberto; `ERR-0012-01`, `ERR-0012-02` e `ERR-0012-16`
- [ ] **T-0012-03 — Movimentos de saldo e limite no `accounts`** · #55
    - What: `BankAccountService.applyBalanceDelta` e `CreditCardService.applyAvailableLimitDelta`,
      com lock de escrita pelo `EntityManager` recebido, sem abrir transação, aceitando arquivados
    - Where: `src/accounts/bank-account.service.ts`, `src/accounts/credit-card.service.ts`, `tests/integration/accounts/`
    - Done when: `AC-0012-10` coberto; `INV-0012-10` e `INV-0004-03` verificados
- [ ] **T-0012-04 — Criação de despesa simples e evento `ExpenseCreated`** · #56
    - What: `POST /expenses` para `FIXED` e `VARIABLE` dentro de `TransactionRunner.run`, com a
      validação conta-ou-cartão, recusa de arquivados, reflexo no limite do cartão e o evento no
      catálogo `src/events/expenses.events.ts`
    - Where: `src/expenses/`, `src/events/expenses.events.ts`, `src/api.config.ts`
    - Done when: `AC-0012-03`, `AC-0012-04`, `AC-0012-15`, `AC-0012-17`, `AC-0012-19` e
      `AC-0012-21` cobertos; `INV-0012-03` e `INV-0012-09` verificados
- [ ] **T-0012-05 — Parcelamento** · #57
    - What: `kind: INSTALLMENT` gerando as parcelas na mesma transação, com rateio por `splitCents`,
      datas mensais com dia preservado e limite abatido pelo total
    - Where: `src/expenses/`
    - Done when: `AC-0012-07`, `AC-0012-08` e `AC-0012-09` cobertos; `INV-0012-06` verificado
- [ ] **T-0012-06 — Máquina de status, pagamento e varredura de vencidas** · #58
    - What: `PATCH /expenses/:id/status` com a tabela de transições, pagamento e desfazer movendo
      o saldo da conta, recusa para cartão, `ExpensePaid` e `ExpenseService.markOverdue`
    - Where: `src/expenses/`, `src/events/expenses.events.ts`
    - Done when: `AC-0012-05`, `AC-0012-06`, `AC-0012-11` e `AC-0012-12` cobertos; `INV-0012-04`,
      `INV-0012-05`, `INV-0012-07` e `INV-0012-08` verificados
- [ ] **T-0012-07 — Consulta, alteração, exclusão, autorização e OpenAPI** · #59
    - What: `GET /expenses` com filtros, `GET /expenses/:id`, `PATCH /expenses/:id`, `DELETE`
      com a regra do grupo, `listByCreditCard`, as guardas de perfil e o contrato no `openapi.yaml`
    - Where: `src/expenses/`, `docs/openapi.yaml`
    - Done when: `AC-0012-13`, `AC-0012-14`, `AC-0012-16` e `AC-0012-18` cobertos; `INV-0012-11`,
      `INV-0012-12` e `INV-0012-13`
- [ ] **T-0012-08 — Troca de forma de pagamento** · #60
    - What: `PATCH /expenses/:id/payment-method`, movendo o limite de origem e destino na mesma
      transação, com a regra do grupo de parcelas e o `postedOn` no cartão de destino
    - Where: `src/expenses/`, `docs/openapi.yaml`
    - Done when: `AC-0012-22`, `AC-0012-23` e `AC-0012-24` cobertos; `INV-0012-15` verificado;
      última tarefa: fecha FCB-009 e muda o `status` para `implemented`

## Statements (F004)

Tarefas da [spec 0013](../specs/0013-statements.md), que fecha a issue de entrega
[FCB-010](https://github.com/bhenriq-souza/finances-control-backend/issues/10). Depende das tarefas
da spec 0012 implementadas. Ordem por dependência: schema e encadeamento antes do fechamento; a
janela fechada antes de qualquer leitura que dependa dela; consulta antes do pagamento.

- [ ] **T-0013-01 — Entidades, migration e encadeamento dos ciclos** · #61
    - What: `CreditCardStatement`, `CreditCardStatementPayment` e `CreditCardRefund` com as
      constraints nomeadas, a migration das três tabelas, e a função pura que encadeia os ciclos a
      partir da última fatura fechada usando `cycleFor` do `accounts`
    - Where: `src/statements/`, `src/platform/database/migrations/`
    - Done when: `AC-0013-01` a `AC-0013-04` cobertos; `INV-0013-03` e `INV-0013-04` verificados
- [ ] **T-0013-02 — Fechamento, rolagem e evento `StatementClosed`** · #62
    - What: `StatementService.closeDue` sob o lock consultivo do cartão, com `previous_balance_cents`,
      a passagem da anterior a `ROLLED_OVER`, a fatura que nasce `PAID` com devido `<= 0`, e os
      eventos no catálogo `src/events/statements.events.ts`
    - Where: `src/statements/`, `src/events/statements.events.ts`
    - Done when: `AC-0013-05` e `AC-0013-16` cobertos; `INV-0013-07`, `INV-0013-09` e `INV-0013-10`
      verificados
- [ ] **T-0013-03 — Janela fechada e data de lançamento** · #63
    - What: porta `StatementPeriodGuard` e default de `postedOn` no `expenses`, implementação no
      `statements` registrada na composição, e as regras da janela fechada da spec
    - Where: `src/expenses/`, `src/statements/`, `src/container.ts`
    - Done when: `AC-0013-07`, `AC-0013-08`, `AC-0013-10`, `AC-0013-11` e `AC-0013-21` cobertos;
      `INV-0013-05` e `INV-0013-12` verificados
- [ ] **T-0013-04 — Estornos** · #64
    - What: as rotas de `/credit-card-refunds`, com o limite devolvido e consumido na mesma
      transação, a validação da despesa estornada e o evento `CreditCardRefundRegistered`
    - Where: `src/statements/`, `src/expenses/`, `src/api.config.ts`
    - Done when: `AC-0013-12` coberto; `INV-0013-11` verificado
- [ ] **T-0013-05 — Consulta e resumo de faturas** · #65
    - What: `GET /statements`, `/statements/current` e `/statements/:id`, com projeção das abertas,
      fechamento de recuperação antes de responder, valores e `byExpenseType` derivados, `overdue`,
      e `listByCreditCard` por `postedOn`
    - Where: `src/statements/`, `src/expenses/`, `src/api.config.ts`
    - Done when: `AC-0013-06`, `AC-0013-09`, `AC-0013-17` e `AC-0013-22` cobertos; `INV-0013-01`,
      `INV-0013-02` e `INV-0013-08` verificados
- [ ] **T-0013-06 — Pagamentos, quitação, mínimo e desfazer** · #66
    - What: `POST /statements/:id/payments`, `DELETE /statements/:id/payments/:paymentId` e
      `PATCH /statements/:id`, com os deltas de saldo e limite pelo `accounts`, a quitação da
      cadeia por `markPaidByStatement`/`markUnpaidByStatement` e os eventos de pagamento
    - Where: `src/statements/`, `src/expenses/`, `src/events/statements.events.ts`
    - Done when: `AC-0013-13`, `AC-0013-14`, `AC-0013-15`, `AC-0013-18`, `AC-0013-19` e
      `AC-0013-20` cobertos; `INV-0013-06` verificado
- [ ] **T-0013-07 — Autorização e OpenAPI** · #67
    - What: as guardas de perfil nas rotas e o contrato no `openapi.yaml`
    - Where: `src/statements/`, `docs/openapi.yaml`
    - Done when: `AC-0013-23` coberto; `INV-0013-13` verificado; última tarefa da spec: fecha
      FCB-010 e muda o `status` para `implemented`

## Earnings (F005)

Tarefas da [spec 0014](../specs/0014-earnings.md), que fecha a issue de entrega
[FCB-011](https://github.com/bhenriq-souza/finances-control-backend/issues/11). Depende de
`businessToday` e `applyBalanceDelta`, entregues pelas tarefas da spec 0012, e da spec 0004 implementada.
Ordem por dependência: schema antes de tudo; criação antes de status; consulta, alteração e
OpenAPI por último.

- [ ] **T-0014-01 — Entidades, migration e seed dos tipos** · #71
    - What: `EarningType` e `Earning` com os enums sob CHECK e as constraints nomeadas, e a
      migration com as nove linhas pré-definidas
    - Where: `src/earnings/`, `src/platform/database/migrations/`
    - Done when: `AC-0014-01` e `AC-0014-13` cobertos; `INV-0014-01`, `INV-0014-02` e `INV-0014-04`
      verificados pelas constraints
- [ ] **T-0014-02 — Tipos de receita** · #72
    - What: as rotas de `/earning-types` com unicidade case-insensitive, arquivamento idempotente e
      guardas de perfil, registradas em `api.config.ts`
    - Where: `src/earnings/`, `src/api.config.ts`
    - Done when: `AC-0014-02` coberto; `ERR-0014-01`, `ERR-0014-06` e `ERR-0014-14`
- [ ] **T-0014-03 — Criação de receita e evento `EarningCreated`** · #73
    - What: `POST /earnings` dentro de `TransactionRunner.run`, com a recusa de conta e tipo
      arquivados e o evento no catálogo `src/events/earnings.events.ts`
    - Where: `src/earnings/`, `src/events/earnings.events.ts`, `src/api.config.ts`
    - Done when: `AC-0014-03`, `AC-0014-08` e `AC-0014-11` cobertos; `INV-0014-03` verificado
- [ ] **T-0014-04 — Máquina de status, recebimento e varredura de vencidas** · #74
    - What: `PATCH /earnings/:id/status` com a tabela de transições, recebimento e desfazer movendo
      o saldo pela interface do `accounts`, `EarningReceived` e `EarningService.markOverdue`
    - Where: `src/earnings/`, `src/events/earnings.events.ts`
    - Done when: `AC-0014-04` a `AC-0014-07` cobertos; `INV-0014-03`, `INV-0014-05` e `INV-0014-06`
      verificados
- [ ] **T-0014-05 — Consulta, alteração, exclusão, autorização e OpenAPI** · #75
    - What: `GET /earnings` com filtros, `GET /earnings/:id`, `PATCH /earnings/:id`, `DELETE`, as
      guardas de perfil e o contrato no `openapi.yaml`
    - Where: `src/earnings/`, `docs/openapi.yaml`
    - Done when: `AC-0014-09`, `AC-0014-10` e `AC-0014-12` cobertos; `INV-0014-07` e `INV-0014-08`;
      última tarefa: fecha FCB-011 e muda o `status` para `implemented`

## Domínio

As specs de domínio restantes ainda não foram escritas. Cada uma nasce pela skill `/new-spec` a partir da issue de entrega correspondente, e traz suas próprias tarefas para este arquivo:

| Issue   | Spec prevista    | Requisito                   |
| ------- | ---------------- | --------------------------- |
| FCB-012 | `0015` reporting | saldo previsto e relatórios |
| FCB-013 | `0016` imports   | importação CSV              |
