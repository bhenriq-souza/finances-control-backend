---
id: '0011'
title: Accounts — bancos, contas bancárias e cartões de crédito
status: approved
depends_on: ['0000', '0003', '0010']
---

# 0011 — Accounts

## Goal

Dar às despesas e receitas os lugares onde elas acontecem: bancos, contas bancárias com saldo e
cartões de crédito com limite e ciclo de fatura. Ao final, F003 a F005 têm onde se apoiar, o saldo de
uma conta e o limite disponível de um cartão têm dono único, e nenhum cartão existe sem um ciclo que
permita dizer a que fatura uma despesa pertence.

## Scope / Non-goals

- **Em escopo:** cadastro, consulta e alteração de bancos, contas bancárias e cartões; o saldo de
  abertura de uma conta e o saldo corrente; o limite total e o limite disponível de um cartão; o dia
  de fechamento e o de vencimento, e a derivação do ciclo atual a partir deles; arquivamento;
  autorização por perfil.
- **Fora de escopo:** as despesas e receitas que movem saldo e limite (specs `0012` e `0014`) — aqui
  se define **quem é o dono** desses números, não quem os move; a entidade de fatura e sua geração
  (spec `0013`); saldo previsto e relatórios (spec `0015`); importação CSV (spec `0016`), embora o
  F002 a mencione; conciliação ou ajuste manual de saldo, que não tem requisito e precisará de
  decisão própria; permissão por registro — o RBAC continua por perfil, como na spec `0010`.

## Contracts

### Modelo

Três tabelas, seguindo as convenções da [spec 0003](0003-persistence.md). Toda coluna monetária é
`numeric(14,2)`, atravessa o ORM como inteiro de centavos e nunca é ponto flutuante
([ADR-0007](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0007-monetary-representation.md)).

#### `banks`

| Coluna          | Tipo          | Regra                                                    |
| --------------- | ------------- | -------------------------------------------------------- |
| `id`            | `uuid`        | PK, `gen_random_uuid()`                                  |
| `febraban_code` | `text`        | not null, único (`uq_banks_febraban_code`), três dígitos |
| `name`          | `text`        | not null                                                 |
| `archived_at`   | `timestamptz` | nullable                                                 |
| `created_at`    | `timestamptz` | not null, `now()`                                        |
| `updated_at`    | `timestamptz` | not null, `now()`, trigger `set_updated_at()`            |

`febraban_code` é o código do banco no padrão FEBRABAN — três dígitos, com zeros à esquerda
(`001`, `237`, `260`). `ck_banks_febraban_code` exige exatamente `^[0-9]{3}$`.

#### `bank_accounts`

| Coluna                    | Tipo            | Regra                                                                |
| ------------------------- | --------------- | -------------------------------------------------------------------- |
| `id`                      | `uuid`          | PK                                                                   |
| `bank_id`                 | `uuid`          | not null, FK `banks(id)` `on delete restrict`                        |
| `type`                    | `text`          | not null, `ck_bank_accounts_type`: `CHECKING`/`SAVINGS`/`INVESTMENT` |
| `account_number`          | `text`          | not null                                                             |
| `description`             | `text`          | not null                                                             |
| `opening_balance_cents`   | `numeric(14,2)` | not null, informado no cadastro, imutável                            |
| `current_balance_cents`   | `numeric(14,2)` | not null, nasce igual ao de abertura                                 |
| `overdraft_limit_cents`   | `numeric(14,2)` | not null, default `0`, `ck_bank_accounts_overdraft_limit` ≥ 0        |
| `archived_at`             | `timestamptz`   | nullable                                                             |
| `created_at`/`updated_at` | `timestamptz`   | convenções da spec 0003                                              |

Único por `(bank_id, account_number)` — `uq_bank_accounts_bank_id_account_number`.

`overdraft_limit_cents` é o cheque especial: o saldo **pode** ser negativo, e é o requisito de negócio
que decide o que fazer com isso, não uma constraint de banco. O diagrama do produto chama esse campo
de `creditLimit`; aqui ele tem nome próprio para não se confundir com o limite do cartão.

#### `credit_cards`

| Coluna                    | Tipo            | Regra                                                |
| ------------------------- | --------------- | ---------------------------------------------------- |
| `id`                      | `uuid`          | PK                                                   |
| `bank_id`                 | `uuid`          | not null, FK `banks(id)` `on delete restrict`        |
| `name`                    | `text`          | not null                                             |
| `credit_limit_cents`      | `numeric(14,2)` | not null, `ck_credit_cards_credit_limit` > 0         |
| `available_limit_cents`   | `numeric(14,2)` | not null, nasce igual ao limite total                |
| `closing_day`             | `integer`       | not null, `ck_credit_cards_closing_day` entre 1 e 31 |
| `due_day`                 | `integer`       | not null, `ck_credit_cards_due_day` entre 1 e 31     |
| `archived_at`             | `timestamptz`   | nullable                                             |
| `created_at`/`updated_at` | `timestamptz`   | convenções da spec 0003                              |

Único por `(bank_id, name)` — `uq_credit_cards_bank_id_name`.

### Ciclo de fatura

Fechamento e vencimento são **dias do mês, sem mês** (F002), e podem mudar a qualquer momento. A
derivação do ciclo vive aqui porque é propriedade do cartão; **a fatura como entidade é da spec
`0013`**.

- `cycleFor(card, reference: Date)` devolve `{ closesOn: Date; dueOn: Date; startsOn: Date }`.
- **Dia inexistente no mês** (31 em fevereiro, 30 em abril) resolve para o **último dia do mês**.
  Sem essa regra, um cartão com fechamento no dia 31 não teria fatura em quatro meses do ano.
- **Vencimento antes ou no mesmo dia do fechamento** cai no **mês seguinte** ao fechamento: um cartão
  que fecha dia 28 e vence dia 5 vence no mês seguinte, que é como todo cartão funciona.
- `startsOn` é o dia seguinte ao fechamento anterior — a janela é fechada nas duas pontas e não deixa
  buraco nem sobreposição entre ciclos consecutivos.
- **Vencimento nunca empata com o fechamento.** A resolução de dia inexistente pode colapsar os dois
  numa mesma data — fechar dia 30 e vencer dia 31 dá 28 de fevereiro nos dois casos, uma fatura com
  zero dia para pagar. Quando isso acontece, o vencimento vai para o mês seguinte: `dueOn` é sempre
  posterior a `closesOn`.

Alterar `closing_day` ou `due_day` **só afeta ciclos ainda não fechados**. A spec `0013` grava as
datas em cada fatura no fechamento, e é ela que preserva o passado: aqui, a garantia é que a
alteração é aceita a qualquer momento e nunca recalcula o que já passou.

### Quem pode o quê

O RBAC é por perfil, como na spec `0010`, e segue os
[perfis do produto](https://github.com/bhenriq-souza/finances-control/blob/main/docs/user-profiles.md):
"gerenciar contas" é atribuição do `ADMIN`.

| Operação                  | `ADMIN` | `BILLER` | `VIEWER` |
| ------------------------- | ------- | -------- | -------- |
| Criar, alterar e arquivar | sim     | não      | não      |
| Listar e consultar        | sim     | sim      | sim      |

`BILLER` lê porque precisa escolher a conta ou o cartão ao lançar uma despesa (F003).

### Endpoints

| Método   | Rota                         | Perfil   |
| -------- | ---------------------------- | -------- |
| `POST`   | `/banks`                     | `ADMIN`  |
| `GET`    | `/banks`                     | qualquer |
| `PATCH`  | `/banks/:id`                 | `ADMIN`  |
| `POST`   | `/banks/:id/archive`         | `ADMIN`  |
| `DELETE` | `/banks/:id/archive`         | `ADMIN`  |
| `POST`   | `/bank-accounts`             | `ADMIN`  |
| `GET`    | `/bank-accounts`             | qualquer |
| `GET`    | `/bank-accounts/:id`         | qualquer |
| `PATCH`  | `/bank-accounts/:id`         | `ADMIN`  |
| `POST`   | `/bank-accounts/:id/archive` | `ADMIN`  |
| `DELETE` | `/bank-accounts/:id/archive` | `ADMIN`  |
| `POST`   | `/credit-cards`              | `ADMIN`  |
| `GET`    | `/credit-cards`              | qualquer |
| `GET`    | `/credit-cards/:id`          | qualquer |
| `PATCH`  | `/credit-cards/:id`          | `ADMIN`  |
| `POST`   | `/credit-cards/:id/archive`  | `ADMIN`  |
| `DELETE` | `/credit-cards/:id/archive`  | `ADMIN`  |

**Não há exclusão.** Registro financeiro não se apaga: uma conta encerrada ou um cartão cancelado são
**arquivados**, somem das listagens por padrão e continuam sustentando o histórico que os referencia.
`POST .../archive` arquiva, `DELETE .../archive` desarquiva. `GET` aceita `?archived=true` para
incluí-los.

Valores monetários entram e saem como **inteiro de centavos**, em campos com sufixo `Cents`. Listagens
são ordenadas por `name` (bancos e cartões) ou `description` (contas).

### Corpos

```
BankResponse         { id, febrabanCode, name, archivedAt, createdAt }
BankAccountResponse  { id, bank: BankResponse, type, accountNumber, description,
                       openingBalanceCents, currentBalanceCents, overdraftLimitCents,
                       archivedAt, createdAt }
CreditCardResponse   { id, bank: BankResponse, name, creditLimitCents, availableLimitCents,
                       closingDay, dueDay, currentCycle: { startsOn, closesOn, dueOn },
                       archivedAt, createdAt }
```

`currentCycle` é derivado na resposta, nunca persistido — é o que torna verdadeiro que **um cartão
cadastrado já nasce operante**, sem passo extra que alguém possa esquecer.

Na criação: a conta recebe `openingBalanceCents` (pode ser negativo) e o cartão recebe
`creditLimitCents`; `currentBalanceCents` e `availableLimitCents` **não são aceitos na entrada** — o
primeiro nasce igual ao saldo de abertura e o segundo igual ao limite total.

### Quem move saldo e limite

`current_balance_cents` e `available_limit_cents` **não são informados por ninguém**: `PATCH` não os
aceita, e mandá-los é `400`. Quem os move é despesa ou receita, nas specs `0012` e `0014`, sempre na
mesma transação do lançamento
([ADR-0003](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0003-architecture-style.md),
regra 4).

**Uma exceção, e só uma:** alterar `credit_limit_cents` move `available_limit_cents` na mesma medida,
na mesma transação. O que uma alteração de limite não muda é **quanto já foi gasto** — subir o limite
de 5.000 para 8.000 com 3.000 em uso tem de deixar 5.000 disponíveis, ou o cartão passa a mentir
sobre quanto ainda cabe nele. O disponível **pode ficar negativo**: um banco reduz limite abaixo do
que já está em uso, e o cartão precisa saber dizer isso. O valor continua sem ser informável — ele é
calculado a partir do limite anterior e do disponível anterior.

## Invariants

- **INV-0011-01:** todo valor monetário é `numeric(14,2)` no banco e inteiro de centavos na aplicação
  e na API (INV-0000-04).
- **INV-0011-02:** conta bancária e cartão pertencem a exatamente um banco, e o banco não pode ser
  apagado enquanto houver algum deles (`on delete restrict`).
- **INV-0011-03:** nenhum registro desta spec é apagado; o encerramento é arquivamento, e o
  arquivado continua legível e referenciável.
- **INV-0011-04:** `current_balance_cents` e `available_limit_cents` nunca são informados
  por um cliente. Quem os move é lançamento, na mesma transação (ADR-0003, regra 4) — com a
  única exceção da alteração de `credit_limit_cents`, que ajusta o disponível pela mesma
  diferença, também na mesma transação, preservando o quanto já foi gasto.
  endpoint desta spec — só por lançamento, na mesma transação (ADR-0003, regra 4).
- **INV-0011-05:** `opening_balance_cents` é imutável depois da criação: alterá-lo reescreveria a
  origem de um saldo derivado de lançamentos.
- **INV-0011-06:** um cartão sempre tem ciclo completo e derivável — não existe cartão cadastrado e
  não operante.
- **INV-0011-07:** alterar `closing_day` ou `due_day` não recalcula ciclo já fechado.
- **INV-0011-08:** ciclos consecutivos de um cartão são contíguos e não se sobrepõem.
- **INV-0011-09:** escrita exige perfil `ADMIN`; leitura, qualquer perfil (spec 0010).

## Error cases

| Situação                                               | Comportamento exigido                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **ERR-0011-01** `febrabanCode` fora de `^[0-9]{3}$`    | `400`, `VALIDATION_ERROR` (spec 0002)                                               |
| **ERR-0011-02** `febrabanCode` já cadastrado           | `409`, código `BANK_ALREADY_EXISTS`                                                 |
| **ERR-0011-03** Conta repetida no mesmo banco          | `409`, código `BANK_ACCOUNT_ALREADY_EXISTS`                                         |
| **ERR-0011-04** Cartão com nome repetido no banco      | `409`, código `CREDIT_CARD_ALREADY_EXISTS`                                          |
| **ERR-0011-05** `bankId` inexistente                   | `404`, código `BANK_NOT_FOUND`                                                      |
| **ERR-0011-06** `:id` inexistente                      | `404`, código `BANK_NOT_FOUND`, `BANK_ACCOUNT_NOT_FOUND` ou `CREDIT_CARD_NOT_FOUND` |
| **ERR-0011-07** Vincular a banco arquivado             | `409`, código `BANK_ARCHIVED`                                                       |
| **ERR-0011-08** `closingDay`/`dueDay` fora de 1 a 31   | `400`, `VALIDATION_ERROR`                                                           |
| **ERR-0011-09** `creditLimitCents` ≤ 0                 | `400`, `VALIDATION_ERROR`                                                           |
| **ERR-0011-10** Valor monetário não inteiro            | `400`, `VALIDATION_ERROR` — nunca arredondar em silêncio                            |
| **ERR-0011-11** `PATCH` com campo derivado ou imutável | `400`, `VALIDATION_ERROR` citando o campo recusado                                  |
| **ERR-0011-12** Arquivar o que já está arquivado       | `200`, sem efeito — a operação é idempotente                                        |

## Acceptance criteria

- **AC-0011-01:** criar banco, conta e cartão devolve `201` com o corpo previsto, e a conta nasce com
  `currentBalanceCents` igual ao de abertura e o cartão com `availableLimitCents` igual ao limite.
- **AC-0011-02:** `febrabanCode` repetido recebe `409 BANK_ALREADY_EXISTS`; conta repetida no mesmo
  banco, `409 BANK_ACCOUNT_ALREADY_EXISTS`; cartão com nome repetido no mesmo banco,
  `409 CREDIT_CARD_ALREADY_EXISTS`.
- **AC-0011-03:** o mesmo número de conta em bancos diferentes é aceito.
- **AC-0011-04:** um cartão recém-criado já responde com `currentCycle` completo (INV-0011-06).
- **AC-0011-05:** fechamento no dia 31 produz ciclo terminando em 28 ou 29 de fevereiro, e em 30 de
  abril — nunca um mês sem fatura.
- **AC-0011-06:** cartão que fecha dia 28 e vence dia 5 tem `dueOn` no mês seguinte ao `closesOn`.
- **AC-0011-07:** `startsOn` de um ciclo é o dia seguinte ao `closesOn` do anterior, sem buraco nem
  sobreposição (INV-0011-08).
- **AC-0011-08:** `PATCH` que tente alterar `currentBalanceCents`, `availableLimitCents` ou
  `openingBalanceCents` recebe `400` e não altera nada (INV-0011-04, INV-0011-05).
- **AC-0011-09:** arquivar remove da listagem padrão, mantém em `?archived=true` e preserva o
  registro consultável por `:id`; desarquivar devolve à listagem.
- **AC-0011-10:** arquivar duas vezes seguidas responde `200` nas duas e deixa o mesmo estado.
- **AC-0011-11:** vincular conta ou cartão a banco arquivado recebe `409 BANK_ARCHIVED`.
- **AC-0011-12:** `BILLER` e `VIEWER` listam e consultam, e recebem `403 FORBIDDEN` em qualquer
  escrita; sem perfil, `403 PROFILE_PENDING` em todas (INV-0011-09).
- **AC-0011-13:** valor monetário com fração de centavo recebe `400`, e o banco nunca guarda mais de
- **AC-0011-14:** cartão que fecha no dia 30 e vence no dia 31 tem, em fevereiro, `dueOn` no
  mês seguinte ao `closesOn` — nunca no mesmo dia.
- **AC-0011-15:** alterar `creditLimitCents` de 500.000 para 800.000 num cartão com 300.000 em
  uso resulta em `availableLimitCents` de 500.000; reduzir para 100.000 resulta em −200.000; e
  alterar qualquer outro campo não toca no disponível.
  duas casas.

## Test mapping

| Item                                                          | Teste                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| AC-0011-01, AC-0011-02, AC-0011-03                            | `tests/integration/accounts/registration.spec.ts`                                                |
| AC-0011-04 a AC-0011-07, AC-0011-14, INV-0011-06, INV-0011-08 | `tests/accounts/billing-cycle.spec.ts`                                                           |
| AC-0011-08, INV-0011-04, INV-0011-05                          | `tests/integration/accounts/immutable-fields.spec.ts`                                            |
| AC-0011-15                                                    | `tests/integration/accounts/credit-cards.spec.ts`                                                |
| AC-0011-09, AC-0011-10, INV-0011-03                           | `tests/integration/accounts/archiving.spec.ts`                                                   |
| AC-0011-11, ERR-0011-07                                       | `tests/integration/accounts/archiving.spec.ts`                                                   |
| AC-0011-12, INV-0011-09                                       | `tests/integration/accounts/authorization.spec.ts`                                               |
| AC-0011-13, INV-0011-01, ERR-0011-10                          | `tests/accounts/money-validation.spec.ts` e a suíte de registro                                  |
| INV-0011-02                                                   | `tests/integration/accounts/registration.spec.ts` (FK restrict)                                  |
| INV-0011-07                                                   | `tests/accounts/billing-cycle.spec.ts`; a garantia sobre fatura fechada se completa na spec 0013 |
| ERR-0011-01 a ERR-0011-06, ERR-0011-11, ERR-0011-12           | as suítes de integração acima                                                                    |

## Open questions

Nenhuma.
