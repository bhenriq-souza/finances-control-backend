---
id: '0014'
title: Earnings — receitas, tipos e status
status: draft
depends_on: ['0000', '0003', '0004', '0010', '0011', '0012']
---

# 0014 — Earnings

## Goal

Registrar o que entra: receitas fixas e variáveis, categorizadas por tipo, associadas a uma conta
bancária, com um ciclo de status que diz o que já foi recebido e o que ainda vai entrar. Ao final,
o saldo corrente de uma conta reflete cada receita **recebida** no mesmo instante e na mesma
transação, e a spec `0015` (saldo previsto) encontra aqui as receitas abertas e previstas de que
precisa — com a mesma leitura de status que a spec `0012` fixou para despesas, sem reabrir
nenhuma regra.

## Scope / Non-goals

- **Em escopo:** tipos de receita, com os pré-definidos e os que o usuário cria; a receita e seus
  três tipos de ocorrência, inclusive a parcelada e a geração das parcelas; a associação a uma conta bancária; o reflexo no saldo, na mesma
  transação; a máquina de status, espelho da spec `0012`; a varredura que marca vencidas; os
  eventos `EarningCreated` e `EarningReceived`; autorização por perfil; o contrato no
  `openapi.yaml`.
- **Fora de escopo:** saldo previsto e relatórios (spec `0015`); importação CSV (spec `0016`),
  embora o F005 a mencione; a geração automática das ocorrências mensais de uma receita fixa e o
  agendamento da varredura de vencidas (FCB-015) — esta spec entrega as operações que o job chama;
  receita em cartão de crédito — crédito no cartão é estorno (spec `0013`); transferência entre contas próprias, que não é receita nem despesa e precisará de decisão
  própria; contraparte como entidade — quem deve é descrito em `description` e `notes`, ver
  _Recebíveis de terceiros_ —; autoria por usuário; paginação de listagem.

## Contracts

### Vocabulário e status

A spec `0012` resolveu a ambiguidade Aberto/Previsto dos requisitos, e esta spec a espelha, como lá
ficou registrado. O F005 repete a mesma contradição do F003: diz que receita Aberta "reflete no
saldo disponível" e que Recebida "reflete e deixa de refletir".

- **Saldo corrente** de uma conta (`current_balance_cents`, spec 0011) é dinheiro que **já
  entrou**. Só receita **recebida** o move. Uma receita aberta é expectativa, não entrada: se ela
  somasse ao saldo corrente ao ser lançada, o saldo previsto — que soma as abertas ao corrente —
  contaria a mesma receita duas vezes.
- **`OPEN` (Aberto)** é a receita esperada e ainda não recebida: entra no saldo previsto, não move
  o corrente.
- **`FORECAST` (Previsto)** é a receita **planejada**: não move nada, entra apenas no saldo
  previsto. Produtores: o usuário, e o gerador de recorrência mensal do FCB-015, que cria os meses
  futuros de uma receita fixa como `FORECAST` (planilha legada, item 3.3).
- **`RECEIVED` (Recebido)** é a receita que entrou na conta. É o equivalente de `PAID` em
  despesas, com nome próprio porque o F005 o nomeia assim.
- **`OVERDUE` (Vencido)** é a receita aberta cuja data esperada passou sem recebimento — o salário
  que não caiu, o cliente que não pagou. Só a varredura a atribui.
- **`VERIFYING` (Verificando)** é a receita aberta em conferência — valor a confirmar, depósito não
  identificado — e para o saldo comporta-se **exatamente como `OPEN`**.
- **Hoje** é `businessToday()`, no fuso de negócio `America/Sao_Paulo` (spec 0012).

### Modelo

Duas tabelas, pelas convenções da [spec 0003](0003-persistence.md). Toda coluna monetária é
`numeric(14,2)` e atravessa o ORM como inteiro de centavos
([ADR-0007](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0007-monetary-representation.md)).
Enumerados são `text` sob CHECK, precedente da spec 0010.

#### `earning_types`

| Coluna                    | Tipo          | Regra                                     |
| ------------------------- | ------------- | ----------------------------------------- |
| `id`                      | `uuid`        | PK, `gen_random_uuid()`                   |
| `name`                    | `text`        | not null, único (`uq_earning_types_name`) |
| `archived_at`             | `timestamptz` | nullable                                  |
| `created_at`/`updated_at` | `timestamptz` | convenções da spec 0003                   |

A unicidade de `name` é **case-insensitive**, por índice único funcional `uq_earning_types_name`
sobre `lower(name)`; a aplicação faz `trim` na escrita — a mesma regra de `expense_types`.

**Tipos pré-definidos** (F005) entram pela migration que cria a tabela, como linhas comuns,
arquiváveis e renomeáveis, sem coluna que as distinga. A lista vem do uso real: a planilha legada
não tem coluna de categoria nos recebíveis, e os tipos abaixo agrupam as descrições dos seus 336
recebíveis e das entradas do extrato:

| Tipo                               | O que cobre na planilha                                                  |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `Salário`                          | salário mensal do empregador                                             |
| `Férias, 13º e verbas rescisórias` | férias, 13º, saldo de salário                                            |
| `Rendimento de investimento`       | rendimento automático, juros                                             |
| `Restituição de imposto`           | restituição de IR                                                        |
| `Reembolso`                        | compra feita no próprio cartão para outra pessoa, ou despesa reembolsada |
| `Devolução de empréstimo`          | empréstimo concedido a outra pessoa, devolvido em parcelas               |
| `Rateio de despesa`                | parte de terceiros numa viagem, refeição ou evento dividido              |
| `Outros`                           | acertos, adiantamentos e o que não couber acima                          |

A lista não é fechada: as demais categorias nascem pelas rotas de `/earning-types`, que a página de
administração do frontend consome, ou pela importação CSV (spec `0016`) — como em despesas.

#### Recebíveis de terceiros

`Reembolso`, `Devolução de empréstimo` e `Rateio de despesa` são os **recebíveis**: dinheiro que
uma pessoa deve. Não há entidade de contraparte: o recebível é uma receita como outra, e **quem
deve e o quê** vão em `description` e `notes` — "Notebook — Júnior", lançado como receita
parcelada em 10×, ver _Parcelamento_. É o que a
planilha faz com a coluna `Pagante`, e a importação (spec `0016`) leva essa coluna para `notes`.
Um recebível em aberto é uma receita `OPEN`: entra no saldo previsto e vira `OVERDUE` pela
varredura quando a data esperada passa sem pagamento.

Tipos de receita e de despesa são tabelas separadas: o F005 pede "tipos de receitas" próprios, e
uma lista única obrigaria o usuário a ver `Moradia` ao lançar um salário.

#### `earnings`

| Coluna                    | Tipo            | Regra                                                                              |
| ------------------------- | --------------- | ---------------------------------------------------------------------------------- |
| `id`                      | `uuid`          | PK                                                                                 |
| `description`             | `text`          | not null                                                                           |
| `earning_type_id`         | `uuid`          | not null, FK `earning_types(id)` `on delete restrict`                              |
| `kind`                    | `text`          | not null, `ck_earnings_kind`: `FIXED`/`VARIABLE`/`INSTALLMENT`                     |
| `status`                  | `text`          | not null, `ck_earnings_status`: `OPEN`/`FORECAST`/`RECEIVED`/`OVERDUE`/`VERIFYING` |
| `amount_cents`            | `numeric(14,2)` | not null, `ck_earnings_amount` > 0                                                 |
| `occurred_on`             | `date`          | not null — a data **esperada** do recebimento                                      |
| `received_on`             | `date`          | nullable, `ck_earnings_received_on`: not null **se e só se** `status = 'RECEIVED'` |
| `bank_account_id`         | `uuid`          | not null, FK `bank_accounts(id)` `on delete restrict`                              |
| `installment_group_id`    | `uuid`          | nullable                                                                           |
| `installment_number`      | `integer`       | nullable                                                                           |
| `installment_total`       | `integer`       | nullable                                                                           |
| `notes`                   | `text`          | nullable                                                                           |
| `created_at`/`updated_at` | `timestamptz`   | convenções da spec 0003                                                            |

- `ck_earnings_installment`: as três colunas `installment_*` são não nulas **se e só se**
  `kind = 'INSTALLMENT'`; `installment_total >= 2` e `1 <= installment_number <= installment_total`
  — a mesma regra de `expenses` (spec 0012).
- `uq_earnings_installment_group_id_installment_number` sobre
  `(installment_group_id, installment_number)`.
- Índices: `idx_earnings_occurred_on`, `idx_earnings_bank_account_id`, `idx_earnings_status`.

**`occurred_on`** é a data em que a receita é esperada — o dia do salário, o vencimento da nota
emitida. A varredura de vencidas usa esta data. **`received_on`** é a data em que ela de fato
entrou, que pode ser antes ou depois.

A FK para `bank_accounts` é constraint de banco, não acesso de código: o módulo `earnings` só toca
a conta pela interface pública do `accounts` (ADR-0003, regra 2).

### Tipos de ocorrência

| `kind`        | O que é                                                                       | Regra                                                                                             |
| ------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `FIXED`       | Ocorre todo mês (salário, aluguel)                                            | Uma linha por ocorrência. A geração dos meses seguintes é do FCB-015, que os cria como `FORECAST` |
| `VARIABLE`    | Ocorre uma vez                                                                | Uma linha                                                                                         |
| `INSTALLMENT` | Recebimento dividido em parcelas mensais (reembolso, devolução de empréstimo) | `n` linhas criadas de uma vez, ver _Parcelamento_                                                 |

### Parcelamento

A planilha legada registra recebíveis parcelados — o reembolso de uma compra parcelada no próprio
cartão, a devolução de um empréstimo em prestações — numa coluna `Parcelamento`. A receita
parcelada segue **exatamente** as regras de parcelamento da spec 0012, sem acrescentar nenhuma:

- `POST /earnings` com `kind: 'INSTALLMENT'` recebe o **total** em `amountCents` e
  `installmentTotal` (`2` a `120`), e cria `installmentTotal` linhas na mesma transação, todas com
  o mesmo `installment_group_id` (gerado), `installment_number` de 1 a `n`, o mesmo tipo, a mesma
  conta, a mesma `description` e o mesmo `notes`.
- **Rateio** por `splitCents` (spec 0012, ADR-0007 regra 3): resto na primeira parcela; a soma das
  parcelas é o total, sempre.
- **Datas**: a parcela `k` é esperada em `occurredOn + (k − 1)` meses, com dia inexistente
  resolvido para o último dia do mês e o dia original preservado.
- **Status**: todas nascem com o `status` informado (`OPEN` por padrão). Nenhuma move saldo ao
  nascer; cada parcela soma ao saldo quando é **recebida**, individualmente, pela máquina de
  status — a devolução de um empréstimo cai uma prestação por vez.
- Não existe a receita-mãe: o total do grupo é a soma das parcelas, derivado, nunca gravado.
- **Excluir** uma parcela exclui, na mesma transação, todas as parcelas **não recebidas** do
  grupo; as recebidas permanecem — a regra de "cancelar o que ainda vai entrar, nunca o que já
  entrou" da spec 0012.
- **Trocar a conta** de uma parcela por `PATCH` troca a de todas as parcelas não recebidas do
  grupo; as recebidas ficam na conta em que entraram. Alterar `amountCents`, `occurredOn` ou os
  demais campos altera **só aquela parcela**.

### Reflexo no saldo (mesma transação)

Cada operação que move saldo roda dentro de um único `TransactionRunner.run` (spec 0004), e o
reflexo é uma chamada síncrona a `BankAccountService.applyBalanceDelta`, a interface que a spec
`0012` acrescentou ao `accounts`, com o `EntityManager` do escopo (INV-0004-03). Nada aqui passa
por evento, e esta spec não acrescenta nada ao `accounts`.

| Operação                                        | Saldo corrente da conta          |
| ----------------------------------------------- | -------------------------------- |
| Criar, em qualquer status permitido             | nada                             |
| `OPEN`/`OVERDUE`/`VERIFYING → RECEIVED`         | `current_balance += amountCents` |
| `RECEIVED → OPEN` (desfazer recebimento)        | `current_balance −= amountCents` |
| Alterar `amountCents` ou a conta (não recebida) | nada                             |
| Excluir (não recebida)                          | nada                             |

Receber numa conta arquivada é aceito — a receita antiga ainda pode cair numa conta encerrada; o
que se recusa é lançar receita **nova** em conta arquivada (`ERR-0014-05`), como em despesas.

### Máquina de status

```
            ┌──────────── criar ────────────┐
            ▼                               ▼
        FORECAST ──confirmar──▶ OPEN ◀──────────────┐
                                 │ ▲                │
                     varredura   │ │ desfazer       │ desfazer
                     (vencida)   ▼ │                │
                              OVERDUE               │
                                 │                  │
              OPEN/OVERDUE ──verificar──▶ VERIFYING │
                   ▲                        │       │
                   └────── desfazer ────────┘       │
                                                    │
         OPEN/OVERDUE/VERIFYING ──receber──▶ RECEIVED ┘
```

`PATCH /earnings/:id/status` com `{ status, receivedOn? }` aplica uma transição. As permitidas:

| De                             | Para        | Condição                                                          |
| ------------------------------ | ----------- | ----------------------------------------------------------------- |
| `FORECAST`                     | `OPEN`      | —                                                                 |
| `OPEN`, `OVERDUE`              | `VERIFYING` | —                                                                 |
| `VERIFYING`                    | `OPEN`      | —                                                                 |
| `OPEN`, `OVERDUE`, `VERIFYING` | `RECEIVED`  | `receivedOn` opcional, default hoje                               |
| `RECEIVED`                     | `OPEN`      | desfaz o recebimento: `received_on` volta a nulo, saldo devolvido |

- `FORECAST` só se atribui na **criação**; `OVERDUE` só pela **varredura**. Qualquer outro par é
  `ERR-0014-08`.
- **Varredura de vencidas:** `EarningService.markOverdue(asOf: Date): Promise<number>` muda para
  `OVERDUE` toda receita em `OPEN` com `occurred_on < asOf` e devolve quantas mudou. Idempotente;
  o agendamento diário é do FCB-015, e nenhum endpoint a expõe.

### Eventos

Declarados em `src/events/earnings.events.ts` (spec 0004):

```ts
export const EARNING_CREATED = 'EarningCreated' as const;
export type EarningCreated = DomainEvent<
    typeof EARNING_CREATED,
    {
        earningId: string;
        kind: 'FIXED' | 'VARIABLE' | 'INSTALLMENT';
        status: 'OPEN' | 'FORECAST' | 'VERIFYING';
        amountCents: number;
        occurredOn: string; // `YYYY-MM-DD`
        bankAccountId: string;
        installmentGroupId: string | null;
    }
>;

export const EARNING_RECEIVED = 'EarningReceived' as const;
export type EarningReceived = DomainEvent<
    typeof EARNING_RECEIVED,
    { earningId: string; amountCents: number; bankAccountId: string; receivedOn: string }
>;
```

- `EarningCreated` é publicado **uma vez por linha**: uma devolução em 10× publica 10 eventos, com o
  mesmo `installmentGroupId`.
- `EarningReceived` é publicado na transição para `RECEIVED`; desfazer não publica evento, como
  nas specs `0012` e `0013`.
- Nenhum módulo consome estes eventos nesta spec.

### Quem pode o quê

O mesmo da spec `0012`: o `BILLER` gerencia os lançamentos, e o `ADMIN` também escreve.

| Operação                                       | `ADMIN` | `BILLER` | `VIEWER` |
| ---------------------------------------------- | ------- | -------- | -------- |
| Criar, alterar, mudar status, excluir receitas | sim     | sim      | não      |
| Criar, alterar e arquivar tipos                | sim     | sim      | não      |
| Listar e consultar                             | sim     | sim      | sim      |

### Endpoints

| Método   | Rota                         | Perfil            |
| -------- | ---------------------------- | ----------------- |
| `POST`   | `/earning-types`             | `ADMIN`, `BILLER` |
| `GET`    | `/earning-types`             | qualquer          |
| `PATCH`  | `/earning-types/:id`         | `ADMIN`, `BILLER` |
| `POST`   | `/earning-types/:id/archive` | `ADMIN`, `BILLER` |
| `DELETE` | `/earning-types/:id/archive` | `ADMIN`, `BILLER` |
| `POST`   | `/earnings`                  | `ADMIN`, `BILLER` |
| `GET`    | `/earnings`                  | qualquer          |
| `GET`    | `/earnings/:id`              | qualquer          |
| `PATCH`  | `/earnings/:id`              | `ADMIN`, `BILLER` |
| `PATCH`  | `/earnings/:id/status`       | `ADMIN`, `BILLER` |
| `DELETE` | `/earnings/:id`              | `ADMIN`, `BILLER` |

Tipos de receita seguem o arquivamento das specs 0011 e 0012: `GET` esconde arquivados,
`?archived=true` inclui, arquivar é idempotente, tipo arquivado não recebe receita nova
(`ERR-0014-06`) e continua sustentando as antigas.

**Receita pode ser excluída** se **não recebida** (`FORECAST`, `OPEN`, `OVERDUE`, `VERIFYING`);
`RECEIVED` recebe `ERR-0014-10` — desfaça o recebimento antes, para que o saldo seja devolvido
explicitamente. Excluir não move saldo. Numa parcela, vale a regra do grupo (_Parcelamento_).

**`GET /earnings`** aceita os filtros `from` e `to` (`occurredOn`, inclusivos, `YYYY-MM-DD`),
`status`, `kind`, `earningTypeId`, `bankAccountId` e `installmentGroupId`, todos opcionais e combináveis por E.
Ordenação: `occurredOn` crescente, depois `createdAt`.

**`PATCH /earnings/:id`** aceita `description`, `earningTypeId`, `occurredOn`, `amountCents`,
`bankAccountId` e `notes`. Trocar a conta de uma receita não recebida é um `PATCH` simples, ao
contrário da troca de forma de pagamento de despesa (spec 0012): receita não recebida não está no
saldo de conta nenhuma, então nada se move. A conta de destino precisa existir e não estar
arquivada (`ERR-0014-04`, `ERR-0014-05`). Recusa, citando o campo (`ERR-0014-11`): `kind`,
`status`, `receivedOn` e qualquer `installment*` — mudar status é `PATCH …/status`. `amountCents` e `bankAccountId` de
receita **recebida** são recusados (`ERR-0014-10`): o saldo já a absorveu.

### Corpos

```
EarningTypeResponse  { id, name, archivedAt, createdAt }
EarningResponse      { id, description, kind, status, amountCents, occurredOn, receivedOn, notes,
                       earningType: EarningTypeResponse,
                       bankAccountId,
                       installment: { groupId, number, total } | null,
                       createdAt, updatedAt }
```

Criação (`POST /earnings`), que devolve `201` com **uma lista** de `EarningResponse` — de um
elemento para `FIXED`/`VARIABLE`, de `installmentTotal` elementos para `INSTALLMENT`, em ordem de
parcela, o mesmo formato único da spec 0012:

```
{ description, earningTypeId, kind, amountCents, occurredOn, bankAccountId,
  status?: 'OPEN' | 'FORECAST' | 'VERIFYING',   // default OPEN
  installmentTotal?,                      // obrigatório se INSTALLMENT, proibido nos demais
  notes? }
```

- Datas de negócio (`occurredOn`, `receivedOn`) são `YYYY-MM-DD`, `date` no banco (spec 0003).
- `amountCents` é inteiro positivo em toda entrada; fração de centavo é `400`, nunca arredondada.
- A conta vai por **id**, como em despesas.

### Interface pública do módulo

Além das classes de rota e controller, `src/earnings/index.ts` exporta
`EarningService.markOverdue(asOf)` para o job do FCB-015, e os tipos `EarningKind`,
`EarningStatus` com as constantes `EARNING_KINDS` e `EARNING_STATUSES`. `reporting` (spec `0015`)
lê `earnings` por consulta própria (ADR-0003, regra 5).

## Invariants

- **INV-0014-01:** todo valor monetário é `numeric(14,2)` no banco e inteiro de centavos na
  aplicação e na API; `amount_cents` é sempre positivo (INV-0000-04).
- **INV-0014-02:** toda receita pertence a exatamente uma conta bancária.
- **INV-0014-03:** só receita em `RECEIVED` está somada ao saldo corrente, e a passagem para e de
  `RECEIVED` move o saldo na **mesma transação** (ADR-0003, regra 4). Nenhum outro status ou
  operação move saldo.
- **INV-0014-04:** `received_on` é não nulo se e só se `status = 'RECEIVED'`.
- **INV-0014-05:** `FORECAST` só se atribui na criação; `OVERDUE` só pela varredura.
- **INV-0014-06:** `earnings` não lê nem escreve `bank_accounts` senão pela interface pública do
  `accounts`, passando o `EntityManager` do escopo (ADR-0003, regras 1–3; INV-0004-03). Verificado
  pelo gate `boundaries`.
- **INV-0014-07:** receita recebida não se altera em valor nem em conta, nem se exclui, sem antes
  desfazer o recebimento.
- **INV-0014-08:** escrita exige `ADMIN` ou `BILLER`; leitura, qualquer perfil (spec 0010).
- **INV-0014-09:** a soma das parcelas de um grupo é igual ao total informado na criação, o resto
  fica na primeira parcela, e todas nascem na mesma transação — ou nenhuma.
- **INV-0014-10:** a exclusão e a troca de conta de uma parcela alcançam todas as parcelas não
  recebidas do grupo, e nunca uma recebida.

## Error cases

| Situação                                                                                                                                            | Comportamento exigido                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **ERR-0014-01** Tipo com nome repetido (case-insensitive)                                                                                           | `409`, `EARNING_TYPE_ALREADY_EXISTS`                                       |
| **ERR-0014-02** `:id` inexistente                                                                                                                   | `404`, `EARNING_TYPE_NOT_FOUND` ou `EARNING_NOT_FOUND`                     |
| **ERR-0014-03** `bankAccountId` ausente                                                                                                             | `400`, `VALIDATION_ERROR` citando o campo                                  |
| **ERR-0014-04** `bankAccountId` ou `earningTypeId` inexistente                                                                                      | `404`, `BANK_ACCOUNT_NOT_FOUND` ou `EARNING_TYPE_NOT_FOUND`                |
| **ERR-0014-05** Conta arquivada na criação ou na troca de conta                                                                                     | `409`, `BANK_ACCOUNT_ARCHIVED`                                             |
| **ERR-0014-06** Tipo de receita arquivado                                                                                                           | `409`, `EARNING_TYPE_ARCHIVED`                                             |
| **ERR-0014-07** `kind` fora de `FIXED`/`VARIABLE`/`INSTALLMENT`; `installmentTotal` fora de 2..120, ausente em `INSTALLMENT` ou presente nos demais | `400`, `VALIDATION_ERROR` citando o campo                                  |
| **ERR-0014-08** Transição de status não permitida                                                                                                   | `409`, `EARNING_STATUS_TRANSITION_NOT_ALLOWED`, mensagem com `from` e `to` |
| **ERR-0014-09** `status` na criação fora de `OPEN`/`FORECAST`/`VERIFYING`                                                                           | `400`, `VALIDATION_ERROR`                                                  |
| **ERR-0014-10** Alterar valor ou conta, ou excluir, receita recebida                                                                                | `409`, `EARNING_ALREADY_RECEIVED`                                          |
| **ERR-0014-11** `PATCH` com campo imutável                                                                                                          | `400`, `VALIDATION_ERROR` citando o campo recusado                         |
| **ERR-0014-12** `amountCents` ≤ 0 ou não inteiro                                                                                                    | `400`, `VALIDATION_ERROR` — nunca arredondar em silêncio                   |
| **ERR-0014-13** `from` > `to` na listagem                                                                                                           | `400`, `VALIDATION_ERROR`                                                  |
| **ERR-0014-14** Arquivar tipo já arquivado                                                                                                          | `200`, sem efeito — idempotente                                            |

## Acceptance criteria

- **AC-0014-01:** a migration cria as duas tabelas com as constraints nomeadas e as oito linhas
  pré-definidas em `earning_types`; aplica e reverte num banco limpo.
- **AC-0014-02:** criar tipo devolve `201`; nome repetido, inclusive com caixa diferente, recebe
  `409 EARNING_TYPE_ALREADY_EXISTS`; arquivar esconde da listagem, `?archived=true` mostra, e
  arquivar duas vezes responde `200` nas duas.
- **AC-0014-03:** criar receita `OPEN` devolve `201` e **não** altera `currentBalanceCents` da
  conta; criar como `FORECAST` também não (INV-0014-03).
- **AC-0014-04:** receber uma receita de 5000 numa conta com saldo 1000 deixa o saldo em 6000,
  grava `receivedOn` (default: hoje, no fuso de negócio) e publica `EarningReceived` depois do
  commit; desfazer (`RECEIVED → OPEN`) devolve o saldo a 1000 e zera `receivedOn` (INV-0014-03,
  INV-0014-04).
- **AC-0014-05:** se a gravação da transição falhar, o saldo não foi tocado e nenhum evento foi
  publicado (INV-0014-03).
- **AC-0014-06:** cada transição da tabela é aceita e cada par fora dela recebe
  `409 EARNING_STATUS_TRANSITION_NOT_ALLOWED`; `FORECAST` e `OVERDUE` como alvo de
  `PATCH …/status` são recusados (INV-0014-05).
- **AC-0014-07:** `markOverdue(asOf)` muda para `OVERDUE` as receitas `OPEN` com
  `occurredOn < asOf`, ignora `FORECAST`, `VERIFYING` e `RECEIVED`, devolve a quantidade, e uma
  segunda chamada devolve `0`.
- **AC-0014-08:** conta ou tipo arquivado na criação recebe `409` com o código próprio; trocar a
  conta para uma arquivada recebe `409 BANK_ACCOUNT_ARCHIVED`; receber numa conta que foi
  arquivada depois do lançamento é aceito.
- **AC-0014-09:** trocar a conta de uma receita `OPEN` por `PATCH` não move o saldo de nenhuma das
  duas; alterar `amountCents` ou `bankAccountId` de receita recebida, ou excluí-la, recebe
  `409 EARNING_ALREADY_RECEIVED`; `PATCH` com `status` ou `kind` recebe `400` citando o campo
  (INV-0014-07).
- **AC-0014-10:** `GET /earnings?from=2026-03-01&to=2026-03-31&bankAccountId=…` devolve só as
  receitas daquela conta com `occurredOn` na janela, em ordem de `occurredOn`; `from > to` é `400`.
- **AC-0014-11:** `EarningCreated` é publicado uma vez por receita criada, só depois do commit
  (INV-0004-01).
- **AC-0014-12:** `VIEWER` lista e consulta e recebe `403 FORBIDDEN` em toda escrita; `BILLER`
  escreve; sem perfil, `403 PROFILE_PENDING` (INV-0014-08).
- **AC-0014-13:** `amountCents` com fração de centavo, zero ou negativo recebe `400`, e o banco
  nunca guarda mais de duas casas (INV-0014-01).
- **AC-0014-14:** `INSTALLMENT` com `amountCents: 10000` e `installmentTotal: 3` devolve `201` com
  três receitas de 3334, 3333 e 3333 centavos, mesmo `installment.groupId`, números 1 a 3, esperadas
  em 31/01, 28/02 (29 em bissexto) e 31/03 a partir de 31/01; nenhuma move o saldo; publica três
  `EarningCreated` (INV-0014-09).
- **AC-0014-15:** se a gravação de uma parcela falhar, nenhuma parcela existe (INV-0014-09).
- **AC-0014-16:** receber a parcela 1 de 3334 soma 3334 ao saldo e deixa as demais `OPEN`; excluir
  a parcela 2 exclui as parcelas 2 e 3 e mantém a 1; trocar a conta da parcela 2 de um grupo
  intacto troca a das parcelas 2 e 3 e mantém a da 1, se recebida (INV-0014-10).
- **AC-0014-17:** `installmentTotal` 1 ou 121, ausente em `INSTALLMENT` ou presente em `VARIABLE`
  recebe `400`; `PATCH` com `installmentTotal` recebe `400` citando o campo.

## Test mapping

| Item                                                                                                               | Teste                                                               |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| AC-0014-01                                                                                                         | `tests/integration/platform/database/migrations.spec.ts` (extensão) |
| AC-0014-02, ERR-0014-01, ERR-0014-06, ERR-0014-14                                                                  | `tests/integration/earnings/earning-types.spec.ts`                  |
| AC-0014-03, AC-0014-04, AC-0014-05, INV-0014-03, INV-0014-04                                                       | `tests/integration/earnings/balance.spec.ts`                        |
| AC-0014-06, INV-0014-05, ERR-0014-08                                                                               | `tests/integration/earnings/status.spec.ts`                         |
| AC-0014-07                                                                                                         | `tests/integration/earnings/overdue.spec.ts`                        |
| AC-0014-08, AC-0014-13, INV-0014-01, INV-0014-02, ERR-0014-03 a ERR-0014-05, ERR-0014-07, ERR-0014-09, ERR-0014-12 | `tests/integration/earnings/creation.spec.ts`                       |
| AC-0014-09, INV-0014-07, ERR-0014-10, ERR-0014-11                                                                  | `tests/integration/earnings/update-and-delete.spec.ts`              |
| AC-0014-10, ERR-0014-02, ERR-0014-13                                                                               | `tests/integration/earnings/listing.spec.ts`                        |
| AC-0014-11                                                                                                         | `tests/integration/earnings/events.spec.ts`                         |
| AC-0014-14 a AC-0014-17, INV-0014-09, INV-0014-10, ERR-0014-07                                                     | `tests/integration/earnings/installments.spec.ts`                   |
| AC-0014-12, INV-0014-08                                                                                            | `tests/integration/earnings/authorization.spec.ts`                  |
| INV-0014-06                                                                                                        | gate `boundaries`                                                   |

## Open questions

Nenhuma.
