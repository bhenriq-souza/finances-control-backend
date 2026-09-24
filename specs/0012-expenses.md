---
id: '0012'
title: Expenses — despesas, tipos, parcelamento e status
status: draft
depends_on: ['0000', '0003', '0004', '0010', '0011']
---

# 0012 — Expenses

## Goal

Registrar o que sai: despesas fixas, variáveis e parceladas, categorizadas por tipo, associadas a
uma conta bancária ou a um cartão de crédito, com um ciclo de status que diz o que já foi pago e o
que ainda vai sair. Ao final, o limite disponível de um cartão reflete cada despesa lançada nele no
mesmo instante e na mesma transação; o saldo de uma conta reflete cada despesa **paga**; uma compra
parcelada nasce com todas as parcelas, somando exatamente o total; e a spec `0013` (faturas) e a
`0015` (saldo previsto) encontram aqui os dados de que precisam, sem reabrir nenhuma regra.

## Scope / Non-goals

- **Em escopo:** tipos de despesa, com os pré-definidos e os que o usuário cria; a despesa e seus
  três tipos de ocorrência; a associação exclusiva a conta **ou** cartão; o reflexo no limite do
  cartão e no saldo da conta, na mesma transação; a máquina de status e a resolução da ambiguidade
  Aberto/Previsto dos requisitos; a geração das parcelas e o rateio; a varredura que marca
  vencidas; os eventos `ExpenseCreated` e `ExpensePaid`; a interface pública que `statements` e
  `reporting` leem; autorização por perfil; o contrato no `openapi.yaml`.
- **Fora de escopo:** a fatura e o pagamento de despesas de cartão via fatura (spec `0013`) — aqui
  a despesa de cartão **não** é paga individualmente; o saldo previsto e qualquer relatório (spec
  `0015`); importação CSV (spec `0016`), embora o F003 a mencione; a geração automática das
  ocorrências mensais de uma despesa fixa e o agendamento da varredura de vencidas (FCB-015) —
  esta spec entrega as operações que o job chama; anexos, lembretes, orçamento por categoria;
  autoria por usuário e auditoria de lançamento, que a spec `0010` deixou para quem registra a
  ação e que aqui fica adiada até haver requisito; paginação de listagem — o volume real é de
  centenas de despesas por ano e a listagem é sempre por período.

## Contracts

### Vocabulário e a resolução Aberto/Previsto

Os requisitos F002 e F003 se contradizem sobre "Previsto" e usam "refletir no saldo" para duas
coisas diferentes. Esta spec fixa a leitura, que a `0014` (receitas) espelha:

- **Saldo corrente** de uma conta (`current_balance_cents`, spec 0011) é dinheiro que **já saiu ou
  entrou**. Só despesa **paga** o move. Uma despesa aberta é um compromisso, não uma saída: se ela
  abatesse o saldo corrente ao ser lançada, o saldo previsto do F002 — que soma as abertas ao
  corrente — contaria a mesma despesa duas vezes.
- **Limite disponível** de um cartão (`available_limit_cents`, spec 0011) é **compromisso**, não
  dinheiro: a compra consome limite no ato, como no cartão real. Uma despesa de cartão abate o
  disponível ao ser lançada como aberta, e o limite volta quando a **fatura** é paga (F004, spec
  `0013`) — nunca por pagamento individual da despesa.
- **`OPEN` (Aberto)** é a despesa comprometida e ainda não paga. Conta: entra no saldo previsto,
  não move o corrente. Cartão: já consumiu limite.
- **`FORECAST` (Previsto)** é a despesa **planejada**: não move nada, entra apenas no saldo
  previsto. Ela existe com dois produtores — o usuário, ao lançar uma despesa que ainda não se
  concretizou, e o gerador de recorrência mensal do FCB-015, que cria os meses futuros de uma
  despesa fixa como `FORECAST`. Sem produtor o status morre, como a planilha legada demonstrou
  ([análise, 3.3](https://github.com/bhenriq-souza/finances-control/blob/main/docs/legacy-spreadsheet-analysis.md)).
- **`PAID` (Pago)**, **`OVERDUE` (Vencido)** e **`VERIFYING` (Verificando)** completam o enum.
  `VERIFYING` é uma despesa aberta em conferência — cobrança não reconhecida, valor a confirmar —
  e para saldo e limite comporta-se **exatamente como `OPEN`**; é um marcador para a pessoa, não
  uma regra financeira.

### Modelo

Duas tabelas, pelas convenções da [spec 0003](0003-persistence.md). Toda coluna monetária é
`numeric(14,2)` e atravessa o ORM como inteiro de centavos
([ADR-0007](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0007-monetary-representation.md)).
Enumerados são `text` sob CHECK, precedente da spec 0010.

#### `expense_types`

| Coluna                    | Tipo          | Regra                                     |
| ------------------------- | ------------- | ----------------------------------------- |
| `id`                      | `uuid`        | PK, `gen_random_uuid()`                   |
| `name`                    | `text`        | not null, único (`uq_expense_types_name`) |
| `archived_at`             | `timestamptz` | nullable                                  |
| `created_at`/`updated_at` | `timestamptz` | convenções da spec 0003                   |

A unicidade de `name` é **case-insensitive**: o nome é gravado como informado e comparado
normalizado (`lower(trim(name))`), por índice único funcional
`uq_expense_types_name` sobre `lower(name)`; a aplicação faz `trim` na escrita.

**Tipos pré-definidos** (F003) entram pela migration que cria a tabela, como linhas comuns —
arquiváveis e renomeáveis como qualquer outra, sem coluna que as distinga: a lista abaixo é o
ponto de partida, não uma categoria protegida.

`Moradia` · `Alimentação` · `Transporte` · `Saúde` · `Educação` · `Lazer` · `Vestuário` ·
`Assinaturas` · `Impostos e taxas` · `Outros`

#### `expenses`

| Coluna                    | Tipo            | Regra                                                                          |
| ------------------------- | --------------- | ------------------------------------------------------------------------------ |
| `id`                      | `uuid`          | PK                                                                             |
| `description`             | `text`          | not null                                                                       |
| `expense_type_id`         | `uuid`          | not null, FK `expense_types(id)` `on delete restrict`                          |
| `kind`                    | `text`          | not null, `ck_expenses_kind`: `FIXED`/`VARIABLE`/`INSTALLMENT`                 |
| `status`                  | `text`          | not null, `ck_expenses_status`: `OPEN`/`FORECAST`/`PAID`/`OVERDUE`/`VERIFYING` |
| `amount_cents`            | `numeric(14,2)` | not null, `ck_expenses_amount` > 0                                             |
| `occurred_on`             | `date`          | not null — ver abaixo                                                          |
| `paid_on`                 | `date`          | nullable, `ck_expenses_paid_on`: not null **se e só se** `status = 'PAID'`     |
| `bank_account_id`         | `uuid`          | nullable, FK `bank_accounts(id)` `on delete restrict`                          |
| `credit_card_id`          | `uuid`          | nullable, FK `credit_cards(id)` `on delete restrict`                           |
| `installment_group_id`    | `uuid`          | nullable                                                                       |
| `installment_number`      | `integer`       | nullable                                                                       |
| `installment_total`       | `integer`       | nullable                                                                       |
| `notes`                   | `text`          | nullable                                                                       |
| `created_at`/`updated_at` | `timestamptz`   | convenções da spec 0003                                                        |

Constraints:

- `ck_expenses_owner`: **exatamente um** de `bank_account_id` e `credit_card_id` é não nulo. A
  despesa é de uma conta **ou** de um cartão (F003) — a despesa de cartão não conhece a conta que
  paga a fatura; isso é da fatura.
- `ck_expenses_installment`: as três colunas `installment_*` são não nulas **se e só se**
  `kind = 'INSTALLMENT'`; `installment_total >= 2` e `1 <= installment_number <= installment_total`.
- `uq_expenses_installment_group_id_installment_number` sobre `(installment_group_id,
installment_number)`.
- Índices: `idx_expenses_occurred_on`, `idx_expenses_bank_account_id`, `idx_expenses_credit_card_id`,
  `idx_expenses_status`.

**`occurred_on`** é a data de negócio do lançamento, uma só porque o CSV legado tem uma só
(`Data`): para despesa de **conta**, é o **vencimento** — a varredura de vencidas usa esta data;
para despesa de **cartão**, é a **data da compra** — a fatura a que ela pertence é decidida pela
janela do ciclo em que esta data cai (spec `0013`, regra derivada da planilha legada, item 2.2).

As FKs para `bank_accounts` e `credit_cards` são constraints de banco, não acesso de código: o
módulo `expenses` só toca essas tabelas pela interface pública do `accounts` (ADR-0003, regra 2).

### Tipos de ocorrência

| `kind`        | O que é                               | Regra                                                                                             |
| ------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `FIXED`       | Ocorre todo mês (aluguel, assinatura) | Uma linha por ocorrência. A geração dos meses seguintes é do FCB-015, que os cria como `FORECAST` |
| `VARIABLE`    | Ocorre uma vez                        | Uma linha                                                                                         |
| `INSTALLMENT` | Compra dividida em parcelas mensais   | `n` linhas criadas de uma vez, ver _Parcelamento_                                                 |

### Parcelamento

`POST /expenses` com `kind: 'INSTALLMENT'` recebe o **total** em `amountCents` e `installmentTotal`
(`2` a `120`; a planilha legada chega a 60), e cria `installmentTotal` linhas na mesma transação:

- Todas com o mesmo `installment_group_id` (gerado), `installment_number` de 1 a `n`, o mesmo
  `expense_type_id`, a mesma conta ou cartão, a mesma `description` e o mesmo `notes`.
- **Rateio** pelo ADR-0007, regra 3: divisão inteira em centavos, resto (0 a n−1) absorvido pela
  **primeira** parcela. R$ 100,00 em 3 = 33,34 + 33,33 + 33,33. A soma das parcelas é igual ao
  total, sempre. A aritmética passa por `splitCents(totalCents, parts): number[]`, helper único em
  `src/platform/money.ts`, exportado pela interface da plataforma.
- **Datas**: a parcela `k` ocorre em `occurredOn + (k − 1)` meses. Dia inexistente no mês resolve
  para o **último dia do mês**, a mesma regra do ciclo de fatura (spec 0011): comprar dia 31 de
  janeiro em 3× dá 31/01, 28/02 (ou 29) e 31/03 — o dia original é preservado, não o dia
  colapsado.
- **Status**: as parcelas nascem com o `status` informado (`OPEN` por padrão) — todas. Parcela de
  cartão nascida `OPEN` consome limite: o cartão abate o **total** no ato da compra, como o F003
  exige e como o cartão real faz.
- Não existe a despesa-mãe: o grupo é o conjunto das parcelas, e o total do grupo é a **soma** das
  parcelas, derivado, nunca gravado (planilha legada, item 3.2).

### Reflexo em saldo e limite (mesma transação)

Cada operação abaixo roda dentro de um único `TransactionRunner.run` (spec 0004), e o reflexo é
uma chamada síncrona à interface pública do `accounts` com o `EntityManager` do escopo
(INV-0004-03). Nada aqui passa por evento.

| Operação                             | Despesa de conta                 | Despesa de cartão                               |
| ------------------------------------ | -------------------------------- | ----------------------------------------------- |
| Criar como `OPEN` ou `VERIFYING`     | nada                             | `available_limit −= amountCents`                |
| Criar como `FORECAST`                | nada                             | nada                                            |
| `FORECAST → OPEN`                    | nada                             | `available_limit −= amountCents`                |
| `OPEN`/`OVERDUE`/`VERIFYING → PAID`  | `current_balance −= amountCents` | **recusado** (ERR-0012-09): paga-se pela fatura |
| `PAID → OPEN` (desfazer pagamento)   | `current_balance += amountCents` | não se aplica                                   |
| Alterar `amountCents` (não paga)     | nada                             | `available_limit −= (novo − antigo)`            |
| Excluir `OPEN`/`OVERDUE`/`VERIFYING` | nada                             | `available_limit += amountCents`                |
| Excluir `FORECAST`                   | nada                             | nada                                            |

**Nem o saldo nem o limite barram o lançamento.** O sistema registra o que aconteceu na vida real:
uma compra que estourou o limite ou um pagamento que usou o cheque especial são fatos, e recusá-los
deixaria o registro mentindo. O disponível e o saldo podem ficar negativos (spec 0011 já os
permite); alertar é assunto de relatório, não de validação.

#### Interface pública do `accounts` que esta spec acrescenta

A spec 0011 disse que "quem move saldo e limite é despesa ou receita, na mesma transação", e
deixou para cá o **como**. `src/accounts/index.ts` passa a exportar:

```ts
BankAccountService.applyBalanceDelta(manager: EntityManager, id: string, deltaCents: number): Promise<void>
CreditCardService.applyAvailableLimitDelta(manager: EntityManager, id: string, deltaCents: number): Promise<void>
```

- Ambos leem a linha com **lock de escrita** (`SELECT … FOR UPDATE`) pelo `manager` recebido,
  somam o delta e gravam, na transação de quem chamou. É o que serializa duas despesas
  concorrentes no mesmo cartão (ADR-0003, regra 4).
- `deltaCents` é inteiro, positivo ou negativo, nunca zero. Registro inexistente lança
  `BANK_ACCOUNT_NOT_FOUND`/`CREDIT_CARD_NOT_FOUND`. Registro **arquivado aceita** delta: pagar uma
  despesa antiga numa conta encerrada é legítimo; o que se recusa é lançar despesa **nova** em
  conta ou cartão arquivado, e isso é regra desta spec (ERR-0012-05), verificada antes.
- Nenhum dos dois abre transação: recebem o `manager` e escrevem com ele (INV-0004-03).
- As invariantes da spec 0011 não mudam: os dois campos continuam não informáveis por cliente.

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
              OPEN/OVERDUE/VERIFYING ──pagar──▶ PAID ┘
```

`PATCH /expenses/:id/status` com `{ status, paidOn? }` aplica uma transição. As permitidas:

| De                             | Para        | Condição                                                       |
| ------------------------------ | ----------- | -------------------------------------------------------------- |
| `FORECAST`                     | `OPEN`      | —                                                              |
| `OPEN`, `OVERDUE`              | `VERIFYING` | —                                                              |
| `VERIFYING`                    | `OPEN`      | —                                                              |
| `OPEN`, `OVERDUE`, `VERIFYING` | `PAID`      | só despesa de **conta**; `paidOn` opcional, default hoje (UTC) |
| `PAID`                         | `OPEN`      | desfaz o pagamento: `paid_on` volta a nulo, saldo devolvido    |

- `FORECAST` só se atribui na **criação**; `OVERDUE` só pela **varredura**. Qualquer outro par é
  `ERR-0012-08`.
- **Varredura de vencidas:** `ExpenseService.markOverdue(asOf: Date): Promise<number>` muda para
  `OVERDUE` toda despesa de **conta** em `OPEN` com `occurred_on < asOf` e devolve quantas mudou.
  Despesa de cartão nunca vence individualmente — quem vence é a fatura (spec `0013`). O
  agendamento diário é do FCB-015; esta spec entrega a operação, idempotente, e um endpoint não é
  exposto.
- **Despesa de cartão e `PAID`:** a spec `0013` marca as despesas de uma fatura como pagas e
  devolve o limite quando a fatura é paga, pela interface pública deste módulo
  (`ExpenseService.markPaidByStatement`, cujo contrato a `0013` define). Esta spec garante que a
  API pública **não** o faz.

### Eventos

Declarados em `src/events/expenses.events.ts` (spec 0004, ADR local 0002):

```ts
export const EXPENSE_CREATED = 'ExpenseCreated' as const;
export type ExpenseCreated = DomainEvent<
    typeof EXPENSE_CREATED,
    {
        expenseId: string;
        kind: 'FIXED' | 'VARIABLE' | 'INSTALLMENT';
        status: 'OPEN' | 'FORECAST' | 'VERIFYING';
        amountCents: number;
        occurredOn: string; // ISO date, `YYYY-MM-DD`
        bankAccountId: string | null;
        creditCardId: string | null;
        installmentGroupId: string | null;
    }
>;

export const EXPENSE_PAID = 'ExpensePaid' as const;
export type ExpensePaid = DomainEvent<
    typeof EXPENSE_PAID,
    { expenseId: string; amountCents: number; bankAccountId: string; paidOn: string }
>;
```

- `ExpenseCreated` é publicado **uma vez por linha**: uma compra em 12× publica 12 eventos, cada
  um com o mesmo `installmentGroupId`.
- `ExpensePaid` é publicado na transição para `PAID` por esta API — portanto só para despesa de
  conta. O pagamento via fatura publica os seus próprios eventos na spec `0013`.
- Nenhum módulo consome estes eventos nesta spec. Eles existem porque o ADR-0005 os nomeia e
  porque o primeiro consumidor (notificação, auditoria) não deve exigir mudança em quem publica.

### Quem pode o quê

Pelos [perfis do produto](https://github.com/bhenriq-souza/finances-control/blob/main/docs/user-profiles.md),
"gerenciar pagamentos" é do `BILLER`. O `ADMIN` também escreve: é o precedente da spec 0011, e o
perfil é um só por usuário (spec 0010) — um `ADMIN` que não pudesse lançar despesa teria de
rebaixar a si mesmo para usar o produto.

| Operação                                       | `ADMIN` | `BILLER` | `VIEWER` |
| ---------------------------------------------- | ------- | -------- | -------- |
| Criar, alterar, mudar status, excluir despesas | sim     | sim      | não      |
| Criar, alterar e arquivar tipos                | sim     | sim      | não      |
| Listar e consultar                             | sim     | sim      | sim      |

### Endpoints

| Método   | Rota                         | Perfil            |
| -------- | ---------------------------- | ----------------- |
| `POST`   | `/expense-types`             | `ADMIN`, `BILLER` |
| `GET`    | `/expense-types`             | qualquer          |
| `PATCH`  | `/expense-types/:id`         | `ADMIN`, `BILLER` |
| `POST`   | `/expense-types/:id/archive` | `ADMIN`, `BILLER` |
| `DELETE` | `/expense-types/:id/archive` | `ADMIN`, `BILLER` |
| `POST`   | `/expenses`                  | `ADMIN`, `BILLER` |
| `GET`    | `/expenses`                  | qualquer          |
| `GET`    | `/expenses/:id`              | qualquer          |
| `PATCH`  | `/expenses/:id`              | `ADMIN`, `BILLER` |
| `PATCH`  | `/expenses/:id/status`       | `ADMIN`, `BILLER` |
| `DELETE` | `/expenses/:id`              | `ADMIN`, `BILLER` |

Tipos de despesa seguem o arquivamento da spec 0011: `GET` esconde arquivados, `?archived=true`
inclui, arquivar é idempotente, tipo arquivado não recebe despesa nova (ERR-0012-06) e continua
sustentando as antigas.

**Despesa pode ser excluída**, ao contrário de conta e cartão: um lançamento errado ou duplicado
não é histórico, é engano — e a alternativa, editar até ficar igual a outro, é pior. As regras:

- Só despesa **não paga** (`FORECAST`, `OPEN`, `OVERDUE`, `VERIFYING`); `PAID` recebe
  `ERR-0012-10` — desfaça o pagamento antes, para que o saldo seja devolvido explicitamente.
- Excluir uma **parcela** exclui o **grupo inteiro**, e só se nenhuma parcela estiver paga. Metade
  de um parcelamento não é um parcelamento; quem quer mudar o valor de uma parcela usa `PATCH`.
- A spec `0013` acrescenta uma condição: despesa de cartão em fatura **fechada** não se exclui.
- Despesa de cartão excluída devolve o limite, na mesma transação.

**`GET /expenses`** aceita os filtros `from` e `to` (`occurredOn`, inclusivos, `YYYY-MM-DD`),
`status`, `kind`, `expenseTypeId`, `bankAccountId`, `creditCardId` e `installmentGroupId`, todos
opcionais e combináveis por E. Sem filtro, devolve tudo. Ordenação: `occurredOn` crescente, depois
`createdAt`.

**`PATCH /expenses/:id`** aceita `description`, `expenseTypeId`, `occurredOn`, `amountCents` e
`notes`. Recusa, citando o campo (`ERR-0012-11`): `kind`, `status`, `paidOn`, `bankAccountId`,
`creditCardId` e qualquer `installment*` — trocar a conta ou o cartão de uma despesa é excluir e
lançar de novo; mudar status é `PATCH …/status`. `amountCents` de despesa **paga** é recusado
(`ERR-0012-10`): o saldo já a absorveu. Numa parcela, o `PATCH` altera **só aquela parcela**; o
total do grupo é a soma e acompanha.

### Corpos

```
ExpenseTypeResponse  { id, name, archivedAt, createdAt }
ExpenseResponse      { id, description, kind, status, amountCents, occurredOn, paidOn, notes,
                       expenseType: ExpenseTypeResponse,
                       bankAccountId, creditCardId,
                       installment: { groupId, number, total } | null,
                       createdAt, updatedAt }
```

- Datas de negócio (`occurredOn`, `paidOn`) são `YYYY-MM-DD`, sem hora nem fuso: são `date` no
  banco (spec 0003).
- Conta e cartão vão por **id**: o cliente já tem as listas de `/bank-accounts` e
  `/credit-cards`, e embutir os corpos obrigaria o `expenses` a ler o `accounts` a cada linha.
- `POST /expenses` devolve `201` com **uma lista** de `ExpenseResponse` — de um elemento para
  `FIXED`/`VARIABLE`, de `installmentTotal` elementos para `INSTALLMENT`, em ordem de parcela. Um
  formato só, para o cliente não ter dois caminhos.

Criação (`POST /expenses`):

```
{ description, expenseTypeId, kind, amountCents, occurredOn,
  bankAccountId? | creditCardId?,        // exatamente um
  status?: 'OPEN' | 'FORECAST' | 'VERIFYING',   // default OPEN
  installmentTotal?,                      // obrigatório se INSTALLMENT, proibido nos demais
  notes? }
```

`amountCents` é inteiro positivo em toda entrada; fração de centavo é `400`, nunca arredondada.

### Interface pública do módulo

Além das classes de rota e controller, `src/expenses/index.ts` exporta o que outras specs
consomem — leitura, sempre:

- `ExpenseService.listByCreditCard(creditCardId, range: { from: Date; to: Date })` — despesas de
  um cartão com `occurred_on` na janela, para a fatura (spec `0013`).
- `ExpenseService.markOverdue(asOf)` — para o job do FCB-015.
- Os tipos `ExpenseKind`, `ExpenseStatus` e as constantes `EXPENSE_KINDS`, `EXPENSE_STATUSES`.

`reporting` (spec `0015`) lê por consulta própria, como a regra 5 do ADR-0003 permite.

## Invariants

- **INV-0012-01:** todo valor monetário é `numeric(14,2)` no banco e inteiro de centavos na
  aplicação e na API; `amount_cents` é sempre positivo (INV-0000-04).
- **INV-0012-02:** uma despesa pertence a exatamente uma conta bancária **ou** a exatamente um
  cartão, nunca a ambos nem a nenhum.
- **INV-0012-03:** despesa de cartão em `OPEN`, `OVERDUE` ou `VERIFYING` está abatida do limite
  disponível; em `FORECAST`, não; a passagem entre esses estados move o limite na **mesma
  transação** da mudança (ADR-0003, regra 4).
- **INV-0012-04:** só despesa de conta em `PAID` está abatida do saldo corrente, e a passagem para
  e de `PAID` move o saldo na **mesma transação**. Nenhum status de despesa de conta move o saldo
  antes do pagamento.
- **INV-0012-05:** despesa de cartão nunca é paga individualmente por esta API; `PAID` para ela só
  vem da fatura (spec `0013`).
- **INV-0012-06:** a soma das parcelas de um grupo é igual ao total informado na criação, o resto
  fica na primeira parcela, e todas as parcelas nascem na mesma transação — ou nenhuma.
- **INV-0012-07:** `paid_on` é não nulo se e só se `status = 'PAID'`.
- **INV-0012-08:** `FORECAST` não move saldo nem limite, e só se atribui na criação; `OVERDUE` só
  se atribui pela varredura, e só a despesa de conta.
- **INV-0012-09:** saldo e limite nunca barram um lançamento; ficar negativo é permitido e
  registrado.
- **INV-0012-10:** `expenses` não lê nem escreve `bank_accounts` e `credit_cards` senão pela
  interface pública do `accounts`, passando o `EntityManager` do escopo (ADR-0003, regras 1–3;
  INV-0004-03). Verificado pelo gate `boundaries`.
- **INV-0012-11:** despesa paga não se altera em valor nem se exclui sem antes desfazer o
  pagamento.
- **INV-0012-12:** escrita exige `ADMIN` ou `BILLER`; leitura, qualquer perfil (spec 0010).
- **INV-0012-13:** a exclusão de uma parcela exclui o grupo inteiro, e nunca um grupo com parcela
  paga.

## Error cases

| Situação                                                                                           | Comportamento exigido                                                                |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **ERR-0012-01** Tipo com nome repetido (case-insensitive)                                          | `409`, `EXPENSE_TYPE_ALREADY_EXISTS`                                                 |
| **ERR-0012-02** `:id` inexistente                                                                  | `404`, `EXPENSE_TYPE_NOT_FOUND` ou `EXPENSE_NOT_FOUND`                               |
| **ERR-0012-03** Conta e cartão ambos informados, ou nenhum                                         | `400`, `VALIDATION_ERROR` citando os dois campos                                     |
| **ERR-0012-04** `bankAccountId`/`creditCardId`/`expenseTypeId` inexistente                         | `404`, `BANK_ACCOUNT_NOT_FOUND`, `CREDIT_CARD_NOT_FOUND` ou `EXPENSE_TYPE_NOT_FOUND` |
| **ERR-0012-05** Conta ou cartão arquivado                                                          | `409`, `BANK_ACCOUNT_ARCHIVED` ou `CREDIT_CARD_ARCHIVED`                             |
| **ERR-0012-06** Tipo de despesa arquivado                                                          | `409`, `EXPENSE_TYPE_ARCHIVED`                                                       |
| **ERR-0012-07** `installmentTotal` fora de 2..120, ausente em `INSTALLMENT` ou presente nos demais | `400`, `VALIDATION_ERROR` citando o campo                                            |
| **ERR-0012-08** Transição de status não permitida                                                  | `409`, `EXPENSE_STATUS_TRANSITION_NOT_ALLOWED`, mensagem com `from` e `to`           |
| **ERR-0012-09** Pagar despesa de cartão                                                            | `409`, `CREDIT_CARD_EXPENSE_PAID_BY_STATEMENT`                                       |
| **ERR-0012-10** Alterar valor ou excluir despesa paga                                              | `409`, `EXPENSE_ALREADY_PAID`                                                        |
| **ERR-0012-11** `PATCH` com campo imutável                                                         | `400`, `VALIDATION_ERROR` citando o campo recusado                                   |
| **ERR-0012-12** `amountCents` ≤ 0 ou não inteiro                                                   | `400`, `VALIDATION_ERROR` — nunca arredondar em silêncio                             |
| **ERR-0012-13** Excluir parcela de grupo com parcela paga                                          | `409`, `INSTALLMENT_GROUP_HAS_PAID_EXPENSE`                                          |
| **ERR-0012-14** `status` na criação fora de `OPEN`/`FORECAST`/`VERIFYING`                          | `400`, `VALIDATION_ERROR`                                                            |
| **ERR-0012-15** `from` > `to` na listagem                                                          | `400`, `VALIDATION_ERROR`                                                            |
| **ERR-0012-16** Arquivar tipo já arquivado                                                         | `200`, sem efeito — idempotente                                                      |

## Acceptance criteria

- **AC-0012-01:** a migration cria as duas tabelas com as constraints nomeadas e as dez linhas
  pré-definidas em `expense_types`; aplica e reverte num banco limpo.
- **AC-0012-02:** criar tipo devolve `201`; nome repetido, inclusive com caixa diferente, recebe
  `409 EXPENSE_TYPE_ALREADY_EXISTS`; arquivar esconde da listagem, `?archived=true` mostra, e
  arquivar duas vezes responde `200` nas duas.
- **AC-0012-03:** criar despesa `VARIABLE` de conta, `OPEN`, devolve `201` com lista de um
  elemento e **não** altera `currentBalanceCents` da conta (INV-0012-04).
- **AC-0012-04:** criar despesa de cartão, `OPEN`, abate `amountCents` de `availableLimitCents` na
  mesma transação; criar como `FORECAST` não abate; confirmar (`FORECAST → OPEN`) abate
  (INV-0012-03, INV-0012-08).
- **AC-0012-05:** pagar despesa de conta abate `amountCents` de `currentBalanceCents`, grava
  `paidOn` (default: a data de hoje em UTC) e publica `ExpensePaid`; desfazer (`PAID → OPEN`)
  devolve o valor e zera `paidOn` (INV-0012-04, INV-0012-07).
- **AC-0012-06:** pagar despesa de cartão recebe `409 CREDIT_CARD_EXPENSE_PAID_BY_STATEMENT` e
  nada muda (INV-0012-05).
- **AC-0012-07:** `INSTALLMENT` com `amountCents: 10000` e `installmentTotal: 3` cria três linhas
  de 3334, 3333 e 3333 centavos, mesmo `installmentGroupId`, números 1 a 3, e o cartão abate
  10000 de uma vez (INV-0012-06).
- **AC-0012-08:** parcelas a partir de 31/01 em 3× ocorrem em 31/01, 28/02 (29 em bissexto) e
  31/03; a partir de 30/01, em 30/01, 28/02 e 30/03.
- **AC-0012-09:** se a gravação de uma parcela falhar, nenhuma parcela existe e o limite não foi
  tocado (INV-0012-06).
- **AC-0012-10:** duas criações concorrentes no mesmo cartão terminam com o limite abatido pela
  soma das duas, sem perda de atualização (ADR-0003, regra 4).
- **AC-0012-11:** `markOverdue(asOf)` muda para `OVERDUE` as despesas de conta `OPEN` com
  `occurredOn < asOf`, ignora as de cartão e as `FORECAST`, devolve a quantidade, e uma segunda
  chamada devolve `0` (INV-0012-08).
- **AC-0012-12:** cada transição da tabela é aceita e cada par fora dela recebe
  `409 EXPENSE_STATUS_TRANSITION_NOT_ALLOWED`; `FORECAST` e `OVERDUE` como alvo de
  `PATCH …/status` são recusados.
- **AC-0012-13:** alterar `amountCents` de despesa de cartão `OPEN` de 1000 para 1500 abate mais
  500 do limite; de despesa paga recebe `409 EXPENSE_ALREADY_PAID`; `PATCH` com `bankAccountId`,
  `status` ou `installmentTotal` recebe `400` citando o campo (INV-0012-11).
- **AC-0012-14:** excluir despesa de cartão `OPEN` devolve o valor ao limite; excluir uma parcela
  exclui todas as do grupo e devolve a soma; excluir parcela de grupo com uma paga recebe
  `409 INSTALLMENT_GROUP_HAS_PAID_EXPENSE`; excluir despesa paga recebe `409 EXPENSE_ALREADY_PAID`
  (INV-0012-13).
- **AC-0012-15:** conta, cartão ou tipo arquivado recebe `409` com o código próprio; pagar despesa
  antiga numa conta arquivada é aceito.
- **AC-0012-16:** `GET /expenses?from=2026-03-01&to=2026-03-31&creditCardId=…` devolve só as
  despesas daquele cartão com `occurredOn` na janela, em ordem de `occurredOn`; `from > to` é
  `400`.
- **AC-0012-17:** a despesa de cartão com limite disponível menor que `amountCents` é aceita e o
  disponível fica negativo; pagar despesa de conta com saldo insuficiente é aceito e o saldo fica
  negativo (INV-0012-09).
- **AC-0012-18:** `VIEWER` lista e consulta e recebe `403 FORBIDDEN` em toda escrita; `BILLER`
  escreve; sem perfil, `403 PROFILE_PENDING` (INV-0012-12).
- **AC-0012-19:** `ExpenseCreated` é publicado uma vez por linha criada, com `installmentGroupId`
  igual nas parcelas, e só depois do commit (INV-0004-01).
- **AC-0012-20:** `splitCents(10000, 3)` devolve `[3334, 3333, 3333]`; `splitCents(1, 3)` devolve
  `[1, 0, 0]`; a soma é sempre o total; `parts < 1` ou não inteiro lança `TypeError`.

## Test mapping

| Item                                                                                     | Teste                                                                                                      |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| AC-0012-01                                                                               | `tests/integration/platform/database/migrations.spec.ts` (extensão)                                        |
| AC-0012-02, ERR-0012-01, ERR-0012-16, ERR-0012-06                                        | `tests/integration/expenses/expense-types.spec.ts`                                                         |
| AC-0012-03, AC-0012-04, AC-0012-17, INV-0012-03, INV-0012-04, INV-0012-09                | `tests/integration/expenses/balance-and-limit.spec.ts`                                                     |
| AC-0012-05, AC-0012-06, AC-0012-12, INV-0012-05, INV-0012-07, ERR-0012-08, ERR-0012-09   | `tests/integration/expenses/status.spec.ts`                                                                |
| AC-0012-11, INV-0012-08                                                                  | `tests/integration/expenses/overdue.spec.ts`                                                               |
| AC-0012-07, AC-0012-08, AC-0012-09, INV-0012-06                                          | `tests/expenses/installments.spec.ts` (datas e rateio) e `tests/integration/expenses/installments.spec.ts` |
| AC-0012-20                                                                               | `tests/platform/money.spec.ts`                                                                             |
| AC-0012-10                                                                               | `tests/integration/accounts/apply-delta.spec.ts`                                                           |
| AC-0012-13, AC-0012-14, INV-0012-11, INV-0012-13, ERR-0012-10, ERR-0012-11, ERR-0012-13  | `tests/integration/expenses/update-and-delete.spec.ts`                                                     |
| AC-0012-15, ERR-0012-03, ERR-0012-04, ERR-0012-05, ERR-0012-07, ERR-0012-12, ERR-0012-14 | `tests/integration/expenses/creation.spec.ts`                                                              |
| AC-0012-16, ERR-0012-15                                                                  | `tests/integration/expenses/listing.spec.ts`                                                               |
| AC-0012-18, INV-0012-12                                                                  | `tests/integration/expenses/authorization.spec.ts`                                                         |
| AC-0012-19                                                                               | `tests/integration/expenses/events.spec.ts`                                                                |
| INV-0012-01, INV-0012-02                                                                 | `tests/integration/expenses/creation.spec.ts` (CHECKs)                                                     |
| INV-0012-10                                                                              | gate `boundaries`                                                                                          |

## Open questions

1. **Tipos pré-definidos:** a lista de dez é provisória. A planilha legada tem 19 tipos em uso;
   se forem esses os pré-definidos, a lista é substituída antes da aprovação.
2. **Quem escreve:** `ADMIN` e `BILLER`. A tabela de perfis do produto dá "pagamentos" só ao
   `BILLER`; a leitura aqui segue o precedente da spec 0011. Confirmar.
3. **Exclusão de despesa:** permitida para não pagas, com exclusão do grupo inteiro de parcelas.
   A alternativa é não excluir nunca, como conta e cartão. Confirmar.
4. **Limite e saldo não barram lançamento:** o disponível e o saldo ficam negativos. A alternativa
   é recusar com `409`. Confirmar.
