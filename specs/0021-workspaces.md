---
id: '0021'
title: Espaços — isolamento dos registros por espaço e membros com perfil
status: approved
depends_on: ['0003', '0004', '0010', '0011', '0012', '0013', '0014', '0015', '0017', '0018', '0019']
---

# 0021 — Espaços e isolamento

## Goal

Fazer de cada usuário aprovado alguém com a sua própria conta no app. Hoje todo usuário com
perfil enxerga e altera os lançamentos, contas, cartões e faturas de todos: o RBAC da spec `0010`
é por perfil, não por linha. Ao final, todo registro financeiro pertence a um **espaço**, cada
usuário aprovado é **membro** de um espaço com um perfil, e nenhuma rota deixa um membro ler,
alterar ou referenciar registro de outro espaço. A aprovação continua como hoje: um usuário se
cadastra, fica pendente e um admin concede o perfil; a concessão passa a dizer também **em qual
espaço**. Bancos e tipos de despesa e de receita continuam globais, como catálogos que só o
**admin da plataforma** escreve. Decisões do responsável em 2026-10-15: espaço com membros,
bancos globais, tipos globais geridos só pelo admin da plataforma, e aprovação e atribuição como
hoje, dizendo em qual espaço.

## Scope / Non-goals

- **Em escopo:**
    - as tabelas `workspaces` e `workspace_members`, e `users.is_platform_admin`;
    - a coluna `workspace_id` em toda tabela de domínio, com FKs compostas e índices únicos por
      espaço;
    - a migration que leva os dados existentes para um espaço só e os perfis atuais para membros;
    - o espaço e o admin da plataforma no contexto da requisição, e as guardas que os leem;
    - o escopo por espaço em todas as leituras e escritas dos módulos `accounts`, `expenses`,
      `earnings`, `statements`, `reporting` e na carga inicial (spec `0019`);
    - as rotas de espaço e a aprovação com espaço novo ou existente;
    - a escrita dos catálogos globais (bancos e tipos) restrita ao admin da plataforma;
    - a suíte de isolamento por rota;
    - o contrato no `openapi.yaml` e a coleção do Postman.
- **Fora de escopo:**
    - um usuário em mais de um espaço e a troca de espaço na tela: na Fase 5, cada usuário é
      membro de no máximo um espaço (INV-0021-02);
    - convite por email e o admin do espaço gerindo os próprios membros: quem aprova e atribui é
      sempre o admin da plataforma;
    - tipos de despesa e de receita próprios de um espaço (o modelo híbrido fica para depois, como
      coluna opcional no tipo);
    - Row Level Security do PostgreSQL (ADR-0003 local);
    - excluir um espaço e os seus registros;
    - conceder ou revogar o admin da plataforma por rota: ele nasce do bootstrap e da migration;
    - as telas, que são da FCF-025.

## Contracts

### Vocabulário

- **Espaço** é a unidade de isolamento: o equivalente a "uma conta no app". Todo registro
  financeiro pertence a exatamente um espaço.
- **Membro** é o vínculo de um usuário com um espaço, com um perfil (`ADMIN`, `BILLER`,
  `VIEWER`). O perfil vale só dentro daquele espaço, com a mesma matriz das specs `0011` a `0020`.
- **Admin da plataforma** é quem aprova usuários, cria e renomeia espaços e escreve os catálogos
  globais. Não é um perfil: é uma marca no usuário, independente de ele ser membro de um espaço.
  Admin da plataforma sem espaço é um estado válido (por exemplo, removido do espaço por outro
  admin da plataforma): ele continua nas rotas de usuário, de espaço e de catálogo, e recebe
  `403 PROFILE_PENDING` só nas rotas de domínio.
- **Catálogo global** são as tabelas lidas por todos os espaços e escritas só pelo admin da
  plataforma: `banks`, `expense_types` e `earning_types`.

### Modelo

Tabelas novas, por migration:

`workspaces`

| Coluna       | Tipo          | Regra                                             |
| ------------ | ------------- | ------------------------------------------------- |
| `id`         | `uuid`        | PK, `gen_random_uuid()`                           |
| `name`       | `text`        | não nulo, 1 a 80 caracteres sem espaço nas pontas |
| `created_at` | `timestamptz` | não nulo, `now()`                                 |
| `updated_at` | `timestamptz` | não nulo, `now()`                                 |

`workspace_members`

| Coluna         | Tipo          | Regra                                                                       |
| -------------- | ------------- | --------------------------------------------------------------------------- |
| `workspace_id` | `uuid`        | FK `workspaces(id)` `on delete restrict`                                    |
| `user_id`      | `uuid`        | FK `users(id)` `on delete cascade`; `uq_workspace_members_user_id`          |
| `profile`      | `text`        | não nulo; `ck_workspace_members_profile` limita a `ADMIN`/`BILLER`/`VIEWER` |
| `granted_at`   | `timestamptz` | não nulo                                                                    |
| `granted_by`   | `uuid`        | nullable, FK `users(id)` `on delete restrict`; nulo é concessão do sistema  |

- PK `(workspace_id, user_id)`. O índice único em `user_id` é o que limita a um espaço por
  usuário na Fase 5; tirá-lo é o caminho para vários espaços, sem migrar dado.

`users` muda:

- ganha `is_platform_admin boolean not null default false`;
- perde `profile`, `profile_granted_at` e `profile_granted_by`, que passam para
  `workspace_members`.

Tabelas de domínio que ganham `workspace_id uuid not null`, FK `workspaces(id)` `on delete
restrict` e índice `idx_<tabela>_workspace_id`:

| Tabela                           | Referências a outras tabelas do espaço, todas compostas com `workspace_id` |
| -------------------------------- | -------------------------------------------------------------------------- |
| `bank_accounts`                  | —                                                                          |
| `credit_cards`                   | conta de pagamento (`bank_accounts`)                                       |
| `expenses`                       | `bank_accounts`, `credit_cards`, `expense_recurrences`                     |
| `expense_recurrences`            | `bank_accounts`, `credit_cards`                                            |
| `earnings`                       | `bank_accounts`, `earning_recurrences`                                     |
| `earning_recurrences`            | `bank_accounts`                                                            |
| `credit_card_statements`         | `credit_cards`                                                             |
| `credit_card_statement_payments` | `credit_card_statements`, `bank_accounts`                                  |
| `credit_card_refunds`            | `credit_cards`                                                             |
| `bank_transfers`                 | `bank_accounts` (origem e destino)                                         |

- Cada tabela referenciada ganha `uq_<tabela>_workspace_id_id UNIQUE (workspace_id, id)`, e cada
  FK entre tabelas do espaço passa a ser composta: `(workspace_id, <coluna>) REFERENCES
<tabela>(workspace_id, id)`. Com isso o banco recusa uma despesa que aponte para o cartão de
  outro espaço, mesmo que o código erre (INV-0021-04). Colunas de referência nulas continuam
  aceitas (`MATCH SIMPLE`).
- As referências aos catálogos globais (`bank_id`, `expense_type_id`, `earning_type_id`) e a
  `users` continuam FKs simples.
- Índices únicos que passam a incluir o espaço:
    - `uq_bank_accounts_bank_id_account_number` vira `(workspace_id, bank_id, account_number)`;
    - `uq_credit_cards_bank_id_name` vira `(workspace_id, bank_id, name)`.
- Os demais únicos já são internos a um registro do espaço (cartão, série, grupo de parcelas) e
  não mudam. `uq_banks_febraban_code`, `uq_expense_types_name` e `uq_earning_types_name`
  continuam globais.

### Migration dos dados existentes

Uma migration só, que sobe e desce:

1. Cria `workspaces` e `workspace_members` e a coluna `users.is_platform_admin`.
2. Se existe pelo menos um usuário com perfil ou uma linha em alguma tabela de domínio, cria **um**
   espaço chamado `Principal`. Banco vazio não ganha espaço.
3. Todo usuário com `profile` não nulo vira membro desse espaço com o mesmo perfil,
   `granted_at = profile_granted_at` e `granted_by = profile_granted_by`.
4. Todo usuário com `profile = 'ADMIN'` ganha `is_platform_admin = true`: quem hoje aprova
   usuários continua aprovando.
5. Adiciona `workspace_id` nulo nas tabelas de domínio, preenche com o espaço `Principal`, e só
   então torna a coluna `not null`, cria os únicos `(workspace_id, id)`, troca as FKs simples
   pelas compostas e recria os índices únicos.
6. Remove `profile`, `profile_granted_at` e `profile_granted_by` de `users`.

O `down` faz o caminho inverso: devolve o perfil a `users` a partir do membro, desfaz as FKs
compostas e remove as colunas e as tabelas. Ele só é seguro com um espaço; com mais de um, falha
de propósito (`RAISE EXCEPTION`), porque juntar espaços perderia o isolamento sem aviso.

### Contexto da requisição

O `RequestStore` (spec `0010`) troca `userProfile` por três campos, preenchidos pela
autenticação a partir do banco na própria requisição, nunca do token (INV-0010-02 continua
valendo):

| Campo             | Tipo             | Origem                           |
| ----------------- | ---------------- | -------------------------------- |
| `workspaceId`     | `string \| null` | `workspace_members.workspace_id` |
| `userProfile`     | `string \| null` | `workspace_members.profile`      |
| `isPlatformAdmin` | `boolean`        | `users.is_platform_admin`        |

Guardas, no vocabulário de `platform/authorization` (ADR-0003, regra 2):

- `requireProfile(...profiles)` continua com a mesma assinatura e passa a ler o perfil do
  membro. Sem espaço, responde `403 PROFILE_PENDING`, como hoje para quem não tem perfil.
- `requirePlatformAdmin()` é nova: exige `isPlatformAdmin`, senão `403 FORBIDDEN`.
- `requireMemberOrPlatformAdmin()` é nova, para leitura de catálogo: passa quem tem perfil em
  algum espaço ou é admin da plataforma.

### Escopo nas consultas

- `platform` expõe `RequestContext.requireWorkspaceId()`, que devolve o espaço do contexto ou
  lança erro interno `WORKSPACE_CONTEXT_MISSING` (`500`). É erro de fiação, como
  `PROFILE_GUARD_WITHOUT_AUTHENTICATION`: uma rota de domínio sem `requireProfile` antes.
- Toda leitura de tabela de domínio filtra por `workspace_id`, inclusive as consultas SQL do
  `reporting`. Toda escrita grava o `workspace_id` do contexto. Nenhum corpo de requisição aceita
  `workspaceId`, e nenhuma resposta de domínio o devolve.
- Um `:id` de outro espaço responde **exatamente** como um `:id` inexistente: o mesmo `404` e o
  mesmo código do erro de não encontrado da spec do módulo (INV-0021-03). Um id de outro espaço
  num corpo (cartão, conta, série) responde como o id inexistente naquele campo.
- As interfaces públicas entre módulos (`src/<módulo>/index.ts`) recebem o `workspaceId` como
  parâmetro explícito quando consultam ou escrevem registro de outro módulo; não o leem do
  contexto, para valer igual numa requisição, num job e num handler de evento.

### Jobs e eventos

- As rotinas diárias da spec `0017` (fechar fatura, marcar vencidos, estender e promover séries)
  rodam sem requisição e percorrem **todos** os espaços. Toda linha que criam herda o
  `workspace_id` da linha de origem (a série, o cartão), nunca de um contexto.
- O envelope `DomainEvent` (spec `0004`) ganha `workspaceId: string | null`. Quem publica preenche
  com o espaço do registro; o handler usa o do evento, nunca o do contexto. `null` só para evento
  que não é de espaço (nenhum hoje).

### Rotas de espaço e de usuário

| Método   | Rota                 | Quem                | O que faz                                                          |
| -------- | -------------------- | ------------------- | ------------------------------------------------------------------ |
| `GET`    | `/users/me`          | autenticado         | Devolve o próprio usuário, com o espaço e a marca de admin         |
| `GET`    | `/users`             | admin da plataforma | Lista os usuários, com espaço e perfil, ordenados por `created_at` |
| `PATCH`  | `/users/:id/profile` | admin da plataforma | Aprova (com espaço novo ou existente) ou troca o perfil no espaço  |
| `DELETE` | `/users/:id/profile` | admin da plataforma | Remove o membro do espaço; o usuário volta a pendente              |
| `GET`    | `/workspaces`        | admin da plataforma | Lista os espaços, para a escolha na aprovação                      |
| `PATCH`  | `/workspaces/:id`    | admin da plataforma | Renomeia um espaço                                                 |

`UserResponse` (spec `0010`) mantém `profile` e `profileGrantedAt`, agora lidos do membro, e
ganha:

```
{ ..., profile, profileGrantedAt, workspace: { id, name } | null, isPlatformAdmin }
```

`WorkspaceResponse`: `{ id, name, memberCount, createdAt }`, ordenados por `name`.

Corpo de `PATCH /users/:id/profile`, validado por zod; exatamente uma das formas:

| Corpo                                          | Situação do usuário | Efeito                                                        |
| ---------------------------------------------- | ------------------- | ------------------------------------------------------------- |
| `{ profile, workspaceId }`                     | pendente            | Vira membro do espaço com o perfil                            |
| `{ profile: 'ADMIN', newWorkspace: { name } }` | pendente            | Cria o espaço e o usuário vira o `ADMIN` dele, numa transação |
| `{ profile }`                                  | membro              | Troca o perfil no espaço em que já está                       |

- `newWorkspace` exige `profile: 'ADMIN'`: um espaço nasce com quem o administra.
- Mudar um membro de espaço não é uma operação: remove-se (`DELETE`) e aprova-se de novo. Na
  Fase 5, o registro fica no espaço; quem muda é o usuário.
- `granted_by` recebe o `id` de quem chamou.

`DELETE /users/:id/profile` remove a linha de `workspace_members`. Os registros do espaço ficam.

`PATCH /workspaces/:id` recebe `{ name }`.

### Bootstrap

O bootstrap da spec `0010` (`IDENTITY_BOOTSTRAP_ADMIN_EMAIL`, só com email verificado) passa a:

1. marcar `is_platform_admin = true`;
2. se o usuário não é membro de espaço algum, criar um espaço com o nome do usuário (ou o email,
   sem nome) e torná-lo `ADMIN` dele, `granted_by` nulo.

Continua só promovendo: nunca rebaixa, nunca tira de um espaço, e não faz nada se o usuário já é
admin da plataforma e membro.

### Catálogos globais

| Rota (specs `0011`, `0012`, `0014`)                                    | Antes             | Agora                         |
| ---------------------------------------------------------------------- | ----------------- | ----------------------------- |
| `GET /banks`, `GET /expense-types`, `GET /earning-types` e os detalhes | qualquer perfil   | membro ou admin da plataforma |
| `POST`, `PATCH`, arquivar e desarquivar bancos                         | `ADMIN`           | admin da plataforma           |
| `POST`, `PATCH`, arquivar e desarquivar tipos de despesa e de receita  | `ADMIN`, `BILLER` | admin da plataforma           |

As demais rotas de domínio mantêm os perfis das suas specs, agora valendo dentro do espaço.

### Carga inicial

A CLI da spec `0019` ganha `--workspace <id>`, obrigatório. Ela confere que o espaço existe antes
de ler a planilha e grava tudo nele. Bancos e tipos continuam sendo procurados no catálogo global.

### Relatórios

Todos os relatórios da spec `0015` (saldo realizado, previsto, por tipo, fluxo de caixa, extrato,
dívida de cartão) agregam só o espaço do contexto. O admin da plataforma não vê relatório de outro
espaço: ele só vê o espaço de que é membro.

## Invariants

- **INV-0021-01:** toda linha de tabela de domínio tem `workspace_id` não nulo.
- **INV-0021-02:** um usuário é membro de no máximo um espaço (`uq_workspace_members_user_id`).
- **INV-0021-03:** nenhuma rota lê, altera, lista, agrega ou referencia registro de outro espaço.
  Para o cliente, o registro de outro espaço é indistinguível de um inexistente.
- **INV-0021-04:** uma linha de domínio só referencia linhas do mesmo espaço; o banco garante isso
  pelas FKs compostas.
- **INV-0021-05:** o espaço da requisição vem sempre de `workspace_members`, lido na requisição;
  nunca do token, de header, de query ou de corpo.
- **INV-0021-06:** jobs e handlers de evento gravam o espaço da linha de origem ou do evento,
  nunca o do contexto.
- **INV-0021-07:** todo espaço com membro tem pelo menos um membro `ADMIN`.
- **INV-0021-08:** só o admin da plataforma escreve os catálogos globais e gere usuários e espaços.
- **INV-0021-09:** existe sempre pelo menos um admin da plataforma enquanto houver usuários com
  perfil; nenhuma rota tira a marca.
- **INV-0021-10:** nenhuma resposta de domínio expõe `workspaceId`; só as rotas de usuário e de
  espaço o mostram.

## Error cases

| Situação                                                                                         | Comportamento exigido                                                         |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| **ERR-0021-01** `:id` de outro espaço em qualquer rota de domínio                                | o mesmo `404` e código do não encontrado do módulo (ex.: `EXPENSE_NOT_FOUND`) |
| **ERR-0021-02** id de outro espaço num corpo                                                     | o mesmo erro do id inexistente naquele campo                                  |
| **ERR-0021-03** Usuário sem espaço em rota de domínio                                            | `403`, `PROFILE_PENDING` (ERR-0010-04)                                        |
| **ERR-0021-04** Quem não é admin da plataforma em rota de usuário, espaço ou escrita de catálogo | `403`, `FORBIDDEN`                                                            |
| **ERR-0021-05** `workspaceId` inexistente na aprovação                                           | `404`, `WORKSPACE_NOT_FOUND`                                                  |
| **ERR-0021-06** `newWorkspace` com perfil que não é `ADMIN`                                      | `400`, `VALIDATION_ERROR` citando `profile`                                   |
| **ERR-0021-07** Pendente aprovado sem `workspaceId` nem `newWorkspace`, ou com os dois           | `400`, `VALIDATION_ERROR`                                                     |
| **ERR-0021-08** `workspaceId` ou `newWorkspace` para quem já é membro                            | `409`, `USER_ALREADY_IN_WORKSPACE`                                            |
| **ERR-0021-09** Troca ou remoção que deixaria um espaço com membros e sem `ADMIN`                | `409`, `LAST_WORKSPACE_ADMIN` (INV-0021-07)                                   |
| **ERR-0021-10** Admin da plataforma alterando o próprio membro                                   | `409`, `CANNOT_CHANGE_OWN_PROFILE` (ERR-0010-06)                              |
| **ERR-0021-11** Nome de espaço vazio, só espaços ou com mais de 80 caracteres                    | `400`, `VALIDATION_ERROR` citando `name`                                      |
| **ERR-0021-12** `PATCH /workspaces/:id` com id inexistente                                       | `404`, `WORKSPACE_NOT_FOUND`                                                  |
| **ERR-0021-13** Rota de domínio sem `requireProfile` lendo o espaço                              | `500`, `WORKSPACE_CONTEXT_MISSING`, registrado em log                         |
| **ERR-0021-14** Carga sem `--workspace` ou com espaço inexistente                                | a CLI termina com código diferente de zero antes de ler a planilha            |

`LAST_ADMIN` (ERR-0010-07) deixa de existir: o admin da plataforma não é removido por rota
(INV-0021-09), e o último `ADMIN` de um espaço é o `LAST_WORKSPACE_ADMIN`.

## Acceptance criteria

Esquema e migration:

- **AC-0021-01:** num banco com dados das specs `0011` a `0020`, a migration cria o espaço
  `Principal`, todas as linhas de domínio ficam nele, cada usuário com perfil vira membro com o
  mesmo perfil, e os `ADMIN` viram admin da plataforma. A suíte atual continua verde.
- **AC-0021-02:** o `down` devolve o esquema e os perfis em `users`; com dois espaços, o `down`
  falha sem alterar nada.
- **AC-0021-03:** um `INSERT` direto de despesa com `workspace_id` do espaço A e `credit_card_id`
  de um cartão do espaço B falha pela FK composta. O mesmo vale para cada linha da tabela de
  referências do Modelo.
- **AC-0021-04:** dois espaços cadastram, cada um, uma conta no mesmo banco com o mesmo número e um
  cartão com o mesmo nome no mesmo banco, sem conflito.

Identity e espaços:

- **AC-0021-05:** o admin da plataforma aprova um pendente com `{ profile: 'ADMIN', newWorkspace:
{ name: 'Casa' } }`; o espaço `Casa` é criado com ele como único membro `ADMIN`, e o
  `GET /users/me` do aprovado traz `workspace.name = 'Casa'`.
- **AC-0021-06:** aprovar outro pendente com `{ profile: 'VIEWER', workspaceId }` do espaço `Casa`
  o torna membro; ele lê os registros de `Casa` e recebe `403` ao lançar.
- **AC-0021-07:** trocar o perfil de um membro com `{ profile }` mantém o espaço. Mandar
  `workspaceId` para quem já é membro recebe `409 USER_ALREADY_IN_WORKSPACE`.
- **AC-0021-08:** remover o membro o devolve a pendente (`403 PROFILE_PENDING` nas rotas de
  domínio), e os registros do espaço continuam lá. Remover ou rebaixar o último `ADMIN` de um
  espaço com outros membros recebe `409 LAST_WORKSPACE_ADMIN`.
- **AC-0021-09:** `GET /workspaces` lista os espaços com `memberCount`; `PATCH /workspaces/:id`
  renomeia. Um membro `ADMIN` que não é admin da plataforma recebe `403` nas duas e em
  `GET /users`.
- **AC-0021-10:** o bootstrap num banco vazio cria o usuário como admin da plataforma e `ADMIN` de
  um espaço com o nome dele; repetir o acesso não muda nada; um admin da plataforma já membro não
  ganha segundo espaço.

Isolamento por módulo (cada um com dois espaços, A e B, e um membro `ADMIN` em cada):

- **AC-0021-11 (accounts):** A não lista, não lê, não altera nem arquiva conta ou cartão de B
  (`404`); criar cartão de A com conta de pagamento de B recebe o erro de conta inexistente.
- **AC-0021-12 (expenses):** A não lista, não lê, não altera, não paga, não confere nem apaga
  despesa ou série de B; criar despesa de A com cartão ou conta de B recebe o erro de id
  inexistente.
- **AC-0021-13 (earnings):** o mesmo de AC-0021-12 para receitas e séries de receita.
- **AC-0021-14 (statements):** A não lista, não lê, não paga, não desfaz pagamento nem estorna em
  fatura ou cartão de B.
- **AC-0021-15 (transfers):** A não cria transferência com origem ou destino em conta de B, nem
  lê, conclui ou cancela transferência de B.
- **AC-0021-16 (reporting):** com lançamentos nos dois espaços, cada relatório da spec `0015`
  devolvido a A soma só os valores de A.
- **AC-0021-17 (jobs):** com séries e cartões nos dois espaços, as rotinas diárias criam as
  ocorrências e fecham as faturas de cada espaço no próprio espaço.
- **AC-0021-18 (catálogos):** um membro `ADMIN` que não é admin da plataforma lê bancos e tipos e
  recebe `403` ao criar, alterar ou arquivar; o admin da plataforma escreve, e A e B veem a mesma
  lista.
- **AC-0021-19 (carga):** a carga com `--workspace` de B grava tudo em B e nada em A; sem o
  parâmetro, termina com erro antes de ler a planilha.

Suíte por rota e contrato:

- **AC-0021-20:** a suíte de isolamento percorre as rotas registradas no app; toda rota de domínio
  com `:id` é chamada por A com um id de B e responde `404`, e toda listagem de A não contém id de
  B. Uma rota registrada que não esteja na suíte faz o teste falhar.
- **AC-0021-21:** o `openapi.yaml` declara as rotas de espaço, os corpos novos de
  `PATCH /users/:id/profile`, os campos novos de `UserResponse`, os erros e os perfis novos dos
  catálogos.

## Test mapping

| Item                                                                                                   | Teste                                                                   |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| AC-0021-01, AC-0021-02, INV-0021-01                                                                    | `tests/integration/platform/workspaces-migration.spec.ts`               |
| AC-0021-03, AC-0021-04, INV-0021-04                                                                    | `tests/integration/platform/workspace-constraints.spec.ts` (SQL direto) |
| AC-0021-05 a AC-0021-10, INV-0021-02, INV-0021-05, INV-0021-07, INV-0021-09, ERR-0021-03 a ERR-0021-12 | `tests/integration/identity/workspaces.spec.ts`                         |
| AC-0021-11, AC-0021-15                                                                                 | `tests/integration/accounts/isolation.spec.ts`                          |
| AC-0021-12                                                                                             | `tests/integration/expenses/isolation.spec.ts`                          |
| AC-0021-13                                                                                             | `tests/integration/earnings/isolation.spec.ts`                          |
| AC-0021-14                                                                                             | `tests/integration/statements/isolation.spec.ts`                        |
| AC-0021-16                                                                                             | `tests/integration/reporting/isolation.spec.ts`                         |
| AC-0021-17, INV-0021-06                                                                                | `tests/integration/<módulo>/isolation.spec.ts`, na seção de jobs        |
| AC-0021-18, INV-0021-08                                                                                | os `isolation.spec.ts` de accounts, expenses e earnings                 |
| AC-0021-19, ERR-0021-14                                                                                | `tests/load/workspace.spec.ts`                                          |
| AC-0021-20, INV-0021-03, INV-0021-10, ERR-0021-01, ERR-0021-02                                         | `tests/integration/isolation/routes.spec.ts`                            |
| ERR-0021-13                                                                                            | `tests/platform/request-context.spec.ts`                                |
| AC-0021-21                                                                                             | `tests/openapi.spec.ts`, `tests/postman.spec.ts` e revisão em PR        |

## Open questions

Nenhuma.
