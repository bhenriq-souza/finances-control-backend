---
id: '0013'
title: Statements — faturas de cartão, fechamento e pagamento
status: draft
depends_on: ['0000', '0003', '0004', '0010', '0011', '0012']
---

# 0013 — Statements

## Goal

Dar ao cartão de crédito a fatura: o conjunto das despesas de um ciclo, com total, fechamento,
vencimento e pagamento. Ao final, toda despesa de cartão pertence a exatamente uma fatura por
regra de data, nunca por ligação manual; o total de uma fatura é sempre derivado das despesas, nunca
digitado; uma fatura fechada não muda mais, nem quando o cartão muda de dia de fechamento ou de
vencimento; e pagar a fatura debita a conta, libera o limite do cartão e marca as despesas como
pagas, tudo na mesma transação.

## Scope / Non-goals

- **Em escopo:** a fatura como entidade; a regra de pertinência despesa↔fatura; o encadeamento dos
  ciclos a partir das faturas já fechadas; o fechamento, inclusive o de recuperação quando nenhum
  job rodou; a imutabilidade da janela fechada, que o módulo `expenses` passa a respeitar; o resumo
  da fatura, por tipo de despesa; o pagamento integral a partir de uma conta bancária e o desfazer
  do pagamento; os eventos `StatementClosed` e `StatementPaid`; autorização por perfil; o contrato
  no `openapi.yaml`.
- **Fora de escopo:** pagamento parcial, pagamento mínimo, crédito rotativo, juros e multa — a
  fatura se paga inteira ou não se paga; estorno e crédito lançados na fatura, que exigiriam
  despesa de valor negativo (a spec `0012` proíbe); o agendamento do fechamento (FCB-015), que esta
  spec torna opcional, ver _Fechamento_; saldo previsto e relatórios (spec `0015`), que leem as
  faturas por consulta própria; importação de faturas históricas (spec `0016`); conciliação com o
  extrato do banco emissor.

## Contracts

### Vocabulário

- **Ciclo** é a janela de datas de um cartão, `startsOn` a `closesOn`, fechada nas duas pontas,
  com o seu `dueOn` (spec 0011).
- **Fatura** é o ciclo visto como cobrança: as despesas daquele cartão cuja `occurredOn` cai na
  janela, e o total delas.
- **Fatura aberta** é a do ciclo que ainda não terminou — a do dia de hoje — e as dos ciclos
  futuros, onde caem as parcelas lançadas adiante (spec 0012). Não é persistida: é **projetada**.
- **Fatura fechada** é a de um ciclo cujo `closesOn` já passou. É persistida, com as datas
  congeladas, e a sua janela não aceita mais mudança.
- **Fatura paga** é uma fatura fechada cujo pagamento foi registrado.
- **Hoje** é a data corrente em UTC, a mesma convenção da spec 0012 para `paidOn`.

### Pertinência: a despesa pertence à fatura por data

Uma despesa de cartão pertence à fatura do mesmo cartão cuja janela contém a sua `occurredOn` —
que, para despesa de cartão, é a data da compra (spec 0012). É a regra da planilha legada
([análise, 2.2](https://github.com/bhenriq-souza/finances-control/blob/main/docs/legacy-spreadsheet-analysis.md)),
e é a resposta à falha mais cara que ela teve: oito ligações manuais fatura↔despesa apontando para
o mês errado (item 3.1). **Não existe coluna, tabela ou endpoint que associe uma despesa a uma
fatura.** A associação é calculada, e por isso não pode ser declarada errada.

Como as janelas de um cartão são contíguas e não se sobrepõem (INV-0011-08), toda data pertence a
exatamente uma fatura.

### Encadeamento dos ciclos

A spec 0011 deriva o ciclo da configuração **atual** do cartão. Isso basta para o presente, mas
não para o passado: depois de uma mudança de `closing_day`, o ciclo derivado poderia começar antes
do fechamento já gravado e sobrepor a fatura fechada. Por isso o ciclo seguinte a uma fatura
fechada não é derivado da configuração sozinha — ele **continua** de onde a última fechada parou:

- **Primeiro ciclo de um cartão:** `cycleFor(card, card.createdAt)` — o ciclo em que o cadastro
  caiu.
- **Ciclo seguinte a uma fatura fechada `f`:** `startsOn = f.closesOn + 1 dia`; `closesOn` e
  `dueOn` são os de `cycleFor(card, startsOn)` com a configuração atual.
- Os ciclos futuros encadeiam da mesma forma, cada um a partir do anterior.

`cycleFor(card, startsOn)` devolve o primeiro fechamento igual ou posterior a `startsOn`, então o
encadeamento nunca deixa buraco nem sobreposição, e uma mudança de `closing_day` produz no máximo
um ciclo mais curto ou mais longo — nunca uma data órfã. A função continua sendo a da spec 0011,
importada de `src/accounts/index.ts`; esta spec não acrescenta derivação ao `accounts`.

Despesa de cartão com `occurredOn` **anterior** ao primeiro ciclo não pertence a fatura nenhuma, e
por isso é recusada (`ERR-0013-08`, ver _A janela fechada_).

### Modelo

Uma tabela, pelas convenções da [spec 0003](0003-persistence.md). Só a fatura **fechada** é
persistida; a aberta é projetada a cada leitura.

#### `credit_card_statements`

| Coluna                      | Tipo          | Regra                                                         |
| --------------------------- | ------------- | ------------------------------------------------------------- |
| `id`                        | `uuid`        | PK, `gen_random_uuid()`                                       |
| `credit_card_id`            | `uuid`        | not null, FK `credit_cards(id)` `on delete restrict`          |
| `starts_on`                 | `date`        | not null                                                      |
| `closes_on`                 | `date`        | not null                                                      |
| `due_on`                    | `date`        | not null                                                      |
| `status`                    | `text`        | not null, `ck_credit_card_statements_status`: `CLOSED`/`PAID` |
| `paid_on`                   | `date`        | nullable                                                      |
| `paid_from_bank_account_id` | `uuid`        | nullable, FK `bank_accounts(id)` `on delete restrict`         |
| `closed_at`                 | `timestamptz` | not null — quando o fechamento foi registrado                 |
| `created_at`/`updated_at`   | `timestamptz` | convenções da spec 0003                                       |

Constraints:

- `uq_credit_card_statements_credit_card_id_closes_on` sobre `(credit_card_id, closes_on)` e
  `uq_credit_card_statements_credit_card_id_starts_on` sobre `(credit_card_id, starts_on)`.
- `ck_credit_card_statements_dates`: `starts_on <= closes_on` e `closes_on < due_on`.
- `ck_credit_card_statements_payment`: `paid_on` e `paid_from_bank_account_id` são não nulos **se e
  só se** `status = 'PAID'`, e `paid_on > closes_on`.

**Não há coluna de total.** O total é a soma das despesas da janela, calculada a cada leitura
(planilha legada, item 3.2: o total digitado divergiu do calculado em duas de três faturas). A
janela fechada não aceita mudança (ver abaixo), então o total de uma fatura fechada é estável sem
precisar ser congelado.

As FKs para `credit_cards` e `bank_accounts` são constraints de banco, não acesso de código: o
módulo `statements` só lê e move cartão e conta pela interface pública do `accounts` (ADR-0003,
regra 2).

### Total da fatura

`totalCents` é a soma de `amountCents` das despesas da janela com status `OPEN`, `VERIFYING` ou
`PAID`. `FORECAST` fica de fora: não consumiu limite (INV-0012-03) e não é cobrança. Despesa de
cartão nunca está em `OVERDUE` (spec 0012).

O resumo agrupa o mesmo conjunto por tipo de despesa, como a planilha fazia por fatura
(análise, 2.2): `byExpenseType` é uma lista de `{ expenseTypeId, name, totalCents }`, ordenada por
`totalCents` decrescente e depois por `name`. A soma dos grupos é igual a `totalCents`, sempre.

### Fechamento

Uma fatura **está fechada** quando `closesOn < hoje`. Fechar não é uma ação de alguém: é a
passagem do dia de fechamento. O que esta spec define é quando esse fato é **registrado** — a
linha em `credit_card_statements` e o evento `StatementClosed`:

- `StatementService.closeDue(asOf: Date, creditCardId?: string): Promise<number>` registra, para
  um cartão ou para todos, cada ciclo encadeado com `closesOn < asOf` que ainda não tem linha, em
  ordem cronológica, e devolve quantos registrou. Um cartão que ficou meses sem registro recebe
  todos os meses de uma vez. Uma segunda chamada com o mesmo `asOf` devolve `0`.
- Cada cartão é registrado numa transação própria (`TransactionRunner.run`, spec 0004), serializada
  por `pg_advisory_xact_lock` sobre o id do cartão — duas chamadas concorrentes nunca registram o
  mesmo ciclo duas vezes. `StatementClosed` é publicado uma vez por linha criada.
- **Quem chama:** o job diário do FCB-015, quando existir, e **toda operação deste módulo sobre um
  cartão**, antes de responder — leitura, pagamento e desfazer chamam
  `closeDue(hoje, creditCardId)` primeiro. A corretude nunca depende de o job ter rodado: sem ele,
  o registro só acontece mais tarde, e `closedAt` diz quando.
- Cartão arquivado também fecha: a fatura de um cartão cancelado continua sendo cobrada.
- A fatura de total zero é registrada como qualquer outra. Ela nunca aparece como vencida (ver
  _Corpos_), e pagá-la não move saldo nem limite.

### A janela fechada

O total de uma fatura fechada não pode mudar, ou o pagamento passa a liberar um limite diferente
do que foi consumido e o registro deixa de bater com a cobrança do banco. Como a pertinência é por
data, proteger a fatura é proteger a **janela**: toda data até o `closesOn` da última fatura
fechada do cartão está fechada — inclusive datas anteriores ao primeiro ciclo.

O módulo `expenses` não pode importar `statements` — é `statements` que lê `expenses` — e a
regra precisa valer dentro da transação da despesa. Por isso a dependência é invertida, como a
spec 0004 faz com os subscribers:

```ts
// declarado por expenses, em src/expenses/index.ts
interface StatementPeriodGuard {
    /** Último dia fechado do cartão; datas até ele, inclusive, estão fechadas. */
    closedThrough(manager: EntityManager, creditCardId: string): Promise<Date>;
}
```

- `expenses` declara a porta e o símbolo `StatementPeriodGuardSymbol`, e a consulta em toda
  escrita de despesa de cartão. Até `statements` existir, o container registra a implementação
  `OpenPeriodGuard` do próprio `expenses`, que devolve uma data mínima — nada fechado.
- `statements` implementa a porta em `StatementPeriodGuardService` e, na composição
  (`src/container.ts`), passa a ser a implementação registrada. É o único ponto em que
  `expenses` depende de `statements`, e é por inversão: nenhum import cruza nesse sentido.
- `closedThrough` **não escreve**: deriva da última fatura persistida e do encadeamento, então
  vale mesmo antes de `closeDue` registrar o fechamento do dia. O último dia fechado é o
  `closesOn` do último ciclo encadeado com `closesOn < hoje`, persistido ou não; se nenhum ciclo
  passou ainda, é o dia anterior ao primeiro ciclo.

Com `d` o último dia fechado do cartão, em despesa de cartão:

| Operação (spec 0012)                                                | `occurredOn` (antiga ou nova) `<= d` |
| ------------------------------------------------------------------- | ------------------------------------ |
| Criar, em qualquer status                                           | recusado (`ERR-0013-08`)             |
| Alterar `amountCents` ou `occurredOn`                               | recusado (`ERR-0013-08`)             |
| `FORECAST → OPEN`                                                   | recusado (`ERR-0013-08`)             |
| Excluir despesa em `OPEN` ou `VERIFYING`                            | recusado (`ERR-0013-08`)             |
| Excluir despesa em `FORECAST`                                       | aceito — não está no total           |
| `OPEN ↔ VERIFYING`; alterar `description`, `expenseTypeId`, `notes` | aceito — não muda o total            |

Alterar `expenseTypeId` muda o `byExpenseType` de uma fatura fechada, mas não o seu total; é
correção de classificação, e é aceita.

A exclusão de parcelas da spec 0012 ("exclui as não pagas do grupo, mantém as pagas") passa a
tratar a parcela de cartão em janela fechada **como paga**: ela permanece, e as demais não pagas do
grupo são excluídas. Excluir diretamente uma parcela em janela fechada continua recusado pela
tabela acima.

### Pagamento

`POST /statements/:id/payment` com `{ bankAccountId, paidOn? }` paga a fatura **inteira**.
`paidOn` é opcional, default hoje, e precisa ser posterior a `closesOn`. Numa única transação
(`TransactionRunner.run`), com lock de escrita na linha da fatura:

1. A fatura precisa estar `CLOSED` (`ERR-0013-03` se `PAID`); a conta precisa existir e não estar
   arquivada (`ERR-0013-05`, `ERR-0013-06`) — pagar é uma saída nova, e conta arquivada não recebe
   saída nova (precedente da spec 0012, ERR-0012-05).
2. `ExpenseService.markPaidByStatement(manager, creditCardId, window, paidOn)` marca como `PAID`,
   com aquele `paid_on`, todas as despesas do cartão na janela em `OPEN` ou `VERIFYING`, e devolve
   `{ count, totalCents }`.
3. `BankAccountService.applyBalanceDelta(manager, bankAccountId, −totalCents)` debita a conta.
4. `CreditCardService.applyAvailableLimitDelta(manager, creditCardId, +totalCents)` libera o
   limite — o que a compra consumiu volta quando a fatura é paga (F004).
5. A fatura passa a `PAID`, com `paid_on` e `paid_from_bank_account_id`; `StatementPaid` é
   publicado.

Com `totalCents = 0`, os passos 3 e 4 não acontecem: a interface do `accounts` recusa delta zero.
O saldo pode ficar negativo e o pagamento é aceito mesmo assim (INV-0012-09): a fatura foi paga, e
o registro diz o que aconteceu. Cartão arquivado não impede o pagamento.

`DELETE /statements/:id/payment` **desfaz** o pagamento, na mesma forma e na ordem inversa: as
despesas da janela em `PAID` voltam a `OPEN` com `paid_on` nulo
(`ExpenseService.markUnpaidByStatement`), a conta recebe `+totalCents`, o limite volta a ser
consumido com `−totalCents`, e a fatura volta a `CLOSED`. Uma despesa que estava em `VERIFYING`
antes do pagamento volta como `OPEN`: o pagamento encerrou a conferência. Desfazer não publica
evento, como o desfazer da spec 0012.

### Interface pública que esta spec acrescenta ao `expenses`

A spec 0012 deixou para cá o contrato de `markPaidByStatement`. `src/expenses/index.ts` passa a
exportar:

```ts
type StatementWindow = { startsOn: Date; closesOn: Date };

ExpenseService.markPaidByStatement(
    manager: EntityManager, creditCardId: string, window: StatementWindow, paidOn: Date,
): Promise<{ count: number; totalCents: number }>

ExpenseService.markUnpaidByStatement(
    manager: EntityManager, creditCardId: string, window: StatementWindow,
): Promise<{ count: number; totalCents: number }>

ExpenseService.listByCreditCard(
    creditCardId: string, range: { from: Date; to: Date }, manager?: EntityManager,
): Promise<CardExpenseSummary[]>

type CardExpenseSummary = {
    id: string; description: string; occurredOn: string; amountCents: number;
    status: ExpenseStatus; expenseType: { id: string; name: string };
    installment: { groupId: string; number: number; total: number } | null;
};

interface StatementPeriodGuard { /* acima */ }
const StatementPeriodGuardSymbol: unique symbol;
```

- Os dois `mark*` escrevem com o `manager` recebido e nunca abrem transação (INV-0004-03), não
  publicam evento e não tocam saldo nem limite — isso é do pagamento, aqui.
- `listByCreditCard` é a da spec 0012, com o tipo de retorno fixado aqui e o `manager` opcional
  para a leitura dentro do pagamento.
- `PATCH /expenses/:id/status` de `PAID → OPEN` em despesa de **cartão** é recusado com
  `409 CREDIT_CARD_EXPENSE_PAID_BY_STATEMENT` (ERR-0012-09): despesa paga pela fatura só se
  despaga desfazendo o pagamento da fatura.

### Eventos

Declarados em `src/events/statements.events.ts` (spec 0004):

```ts
export const STATEMENT_CLOSED = 'StatementClosed' as const;
export type StatementClosed = DomainEvent<
    typeof STATEMENT_CLOSED,
    {
        statementId: string;
        creditCardId: string;
        startsOn: string; // `YYYY-MM-DD`
        closesOn: string;
        dueOn: string;
        totalCents: number;
    }
>;

export const STATEMENT_PAID = 'StatementPaid' as const;
export type StatementPaid = DomainEvent<
    typeof STATEMENT_PAID,
    {
        statementId: string;
        creditCardId: string;
        bankAccountId: string;
        totalCents: number;
        paidOn: string;
    }
>;
```

- `StatementClosed` é o nome que o ADR-0005 já usa. É publicado no **registro** do fechamento, uma
  vez por fatura — nunca no desfazer de nada.
- Nenhum módulo consome estes eventos nesta spec.

### Quem pode o quê

"Gerenciar faturas" é do `BILLER` pelos
[perfis do produto](https://github.com/bhenriq-souza/finances-control/blob/main/docs/user-profiles.md);
o `ADMIN` também escreve, pela mesma razão da spec 0012.

| Operação                     | `ADMIN` | `BILLER` | `VIEWER` |
| ---------------------------- | ------- | -------- | -------- |
| Pagar e desfazer o pagamento | sim     | sim      | não      |
| Listar e consultar faturas   | sim     | sim      | sim      |

Fechar não tem operação: é a passagem do tempo.

### Endpoints

| Método   | Rota                      | Perfil            |
| -------- | ------------------------- | ----------------- |
| `GET`    | `/statements`             | qualquer          |
| `GET`    | `/statements/current`     | qualquer          |
| `GET`    | `/statements/:id`         | qualquer          |
| `POST`   | `/statements/:id/payment` | `ADMIN`, `BILLER` |
| `DELETE` | `/statements/:id/payment` | `ADMIN`, `BILLER` |

- **`GET /statements?creditCardId=…&from=…&to=…`** devolve as faturas do cartão com `closesOn`
  entre `from` e `to` (`YYYY-MM-DD`, inclusivos), fechadas e projetadas, em ordem de `closesOn`.
  `creditCardId` é obrigatório; `from` e `to` são opcionais — sem eles, as fechadas dos últimos
  doze meses e a aberta corrente. A janela pedida cobre no máximo 120 faturas, o maior
  parcelamento da spec 0012 (`ERR-0013-10`). A listagem não traz `expenses`.
- **`GET /statements/current?creditCardId=…`** devolve a fatura aberta do dia, com `expenses`.
- **`GET /statements/:id`** devolve uma fatura fechada ou paga, com `expenses`. A fatura projetada
  não tem `id` e só se lê pelas duas rotas acima.

### Corpos

```
StatementResponse {
    id,                       // null na projetada
    creditCardId,
    status,                   // 'OPEN' (projetada) | 'CLOSED' | 'PAID'
    startsOn, closesOn, dueOn,
    totalCents,
    overdue,                  // status = 'CLOSED' e dueOn < hoje e totalCents > 0
    paidOn, paidFromBankAccountId,   // null fora de 'PAID'
    closedAt,                 // null na projetada
    byExpenseType: [{ expenseTypeId, name, totalCents }],
    expenses?: CardExpenseSummary[]   // só nas rotas de detalhe, em ordem de occurredOn
}
```

- `OPEN` não é persistido: é o status de toda fatura projetada, a corrente e as futuras.
- **Vencida** é derivado, não status: a fatura fechada, não paga e com valor, depois do
  vencimento. Nenhuma varredura muda status de fatura — a spec 0012 já disse que despesa de cartão
  não vence individualmente, e aqui a fatura também não precisa de job para vencer.
- Datas de negócio em `YYYY-MM-DD` (spec 0012); dinheiro em inteiro de centavos com sufixo `Cents`.

### Interface pública do módulo

`src/statements/index.ts` exporta as classes de rota e controller, `StatementService.closeDue`
para o job do FCB-015 e `StatementPeriodGuardService` para a composição. `reporting` (spec `0015`)
lê `credit_card_statements` por consulta própria (ADR-0003, regra 5).

## Invariants

- **INV-0013-01:** toda despesa de cartão com `occurredOn` a partir do primeiro ciclo pertence a
  exatamente uma fatura do seu cartão, determinada só pela data; não existe associação gravada
  entre despesa e fatura.
- **INV-0013-02:** o total de uma fatura é sempre a soma das suas despesas em `OPEN`, `VERIFYING`
  e `PAID`; não há coluna nem caminho de escrita para ele, e a soma de `byExpenseType` é igual a
  ele.
- **INV-0013-03:** as faturas de um cartão, persistidas e projetadas, são contíguas e não se
  sobrepõem, mesmo depois de mudanças de `closing_day` (estende INV-0011-08).
- **INV-0013-04:** uma fatura fechada tem `startsOn`, `closesOn` e `dueOn` congelados: alterar
  `closing_day` ou `due_day` do cartão nunca os muda (completa INV-0011-07).
- **INV-0013-05:** nenhuma operação muda o total de uma fatura fechada; a janela até o último dia
  fechado não aceita criação, mudança de valor ou de data, confirmação nem exclusão de despesa que
  conte no total.
- **INV-0013-06:** o pagamento debita a conta e libera o limite pelo mesmo `totalCents` e marca as
  despesas como pagas na **mesma transação**; o desfazer reverte os três na mesma transação
  (ADR-0003, regra 4).
- **INV-0013-07:** cada ciclo é registrado como fechado no máximo uma vez, e `StatementClosed` é
  publicado exatamente uma vez por fatura registrada.
- **INV-0013-08:** a corretude do fechamento não depende de job: uma fatura cujo `closesOn`
  passou está fechada para a regra da janela e é registrada na primeira operação do módulo sobre
  o cartão.
- **INV-0013-09:** `paid_on` e `paid_from_bank_account_id` são não nulos se e só se
  `status = 'PAID'`, e `paid_on` é posterior a `closes_on`.
- **INV-0013-10:** `statements` não lê nem escreve `expenses`, `credit_cards` e `bank_accounts`
  senão pela interface pública dos módulos donos; `expenses` não importa `statements` (ADR-0003,
  regras 1–3). Verificado pelo gate `boundaries`.
- **INV-0013-11:** escrita exige `ADMIN` ou `BILLER`; leitura, qualquer perfil (spec 0010).

## Error cases

| Situação                                                                        | Comportamento exigido                                                  |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **ERR-0013-01** `:id` inexistente                                               | `404`, `STATEMENT_NOT_FOUND`                                           |
| **ERR-0013-02** `creditCardId` ausente na listagem ou na corrente               | `400`, `VALIDATION_ERROR` citando o campo                              |
| **ERR-0013-03** Pagar fatura já paga                                            | `409`, `STATEMENT_ALREADY_PAID`                                        |
| **ERR-0013-04** Desfazer pagamento de fatura não paga                           | `409`, `STATEMENT_NOT_PAID`                                            |
| **ERR-0013-05** `bankAccountId` ou `creditCardId` inexistente                   | `404`, `BANK_ACCOUNT_NOT_FOUND` ou `CREDIT_CARD_NOT_FOUND`             |
| **ERR-0013-06** Pagar com conta arquivada                                       | `409`, `BANK_ACCOUNT_ARCHIVED`                                         |
| **ERR-0013-07** `paidOn` igual ou anterior a `closesOn`                         | `400`, `VALIDATION_ERROR` citando o campo                              |
| **ERR-0013-08** Escrita em despesa de cartão que muda o total de janela fechada | `409`, `STATEMENT_CLOSED`, mensagem com o `closesOn` da última fechada |
| **ERR-0013-09** `from` > `to` na listagem                                       | `400`, `VALIDATION_ERROR`                                              |
| **ERR-0013-10** Janela da listagem com mais de 120 faturas                      | `400`, `VALIDATION_ERROR`                                              |

## Acceptance criteria

- **AC-0013-01:** a migration cria `credit_card_statements` com as constraints nomeadas; aplica e
  reverte num banco limpo; uma linha `PAID` sem `paid_on` é recusada pelo banco (INV-0013-09).
- **AC-0013-02:** num cartão que fecha dia 10, despesas em 10/03, 11/03 e 10/04 caem em faturas
  diferentes: a de 10/03 na que fecha em 10/03, as outras duas na que fecha em 10/04
  (INV-0013-01).
- **AC-0013-03:** com a fatura de 10/03 fechada, mudar `closing_day` para 5 faz a fatura seguinte
  ir de 11/03 a 05/04; mudar para 25 faz ir de 11/03 a 25/03; em nenhum caso a fechada muda de
  datas ou alguma data fica sem fatura (INV-0013-03, INV-0013-04).
- **AC-0013-04:** mudar `due_day` depois do fechamento mantém o `dueOn` da fatura fechada e muda o
  da aberta — o caso real do Santander, de dia 5 para dia 3 (análise, 3.6).
- **AC-0013-05:** `closeDue(asOf)` num cartão sem nenhum registro e três ciclos passados registra
  três faturas em ordem, publica três `StatementClosed` depois do commit, e uma segunda chamada
  devolve `0` (INV-0013-07).
- **AC-0013-06:** duas chamadas concorrentes de `closeDue` para o mesmo cartão registram cada
  ciclo uma vez só (INV-0013-07).
- **AC-0013-07:** sem nenhum job ter rodado, `GET /statements?creditCardId=…` depois do fechamento
  já mostra a fatura como `CLOSED`, com `closedAt` do momento da leitura (INV-0013-08).
- **AC-0013-08:** a fatura com despesas de 1000 (`OPEN`), 500 (`VERIFYING`) e 300 (`FORECAST`)
  tem `totalCents` 1500, e `byExpenseType` soma 1500 (INV-0013-02).
- **AC-0013-09:** numa janela fechada, criar despesa, alterar `amountCents` ou `occurredOn`,
  confirmar `FORECAST` e excluir despesa `OPEN` recebem `409 STATEMENT_CLOSED`; alterar
  `description`, alternar `OPEN ↔ VERIFYING` e excluir `FORECAST` são aceitos; mover a
  `occurredOn` de uma despesa aberta **para dentro** da janela fechada também é recusado
  (INV-0013-05).
- **AC-0013-10:** despesa de cartão com `occurredOn` anterior ao primeiro ciclo do cartão recebe
  `409 STATEMENT_CLOSED`.
- **AC-0013-11:** um parcelamento de cartão em 3× com a parcela 1 em janela fechada: excluir a
  parcela 2 exclui as parcelas 2 e 3 e mantém a 1.
- **AC-0013-12:** pagar uma fatura de 1500 a partir de uma conta com saldo 10000 deixa o saldo em
  8500, devolve 1500 ao limite disponível, marca as despesas `OPEN` e `VERIFYING` da janela como
  `PAID` com o `paidOn` informado, deixa a `FORECAST` intacta e publica `StatementPaid`
  (INV-0013-06).
- **AC-0013-13:** se qualquer passo do pagamento falhar, nem a conta, nem o cartão, nem as
  despesas, nem a fatura mudam, e nenhum evento é publicado (INV-0013-06).
- **AC-0013-14:** desfazer o pagamento devolve 1500 à conta, consome 1500 do limite, volta as
  despesas para `OPEN` com `paidOn` nulo e a fatura para `CLOSED`; desfazer de novo recebe
  `409 STATEMENT_NOT_PAID`; pagar de novo, depois do desfazer, é aceito.
- **AC-0013-15:** pagar fatura já paga recebe `409 STATEMENT_ALREADY_PAID`; pagar com conta
  arquivada recebe `409 BANK_ACCOUNT_ARCHIVED`; com `paidOn` igual ao `closesOn`, `400`; pagar
  com saldo insuficiente é aceito e o saldo fica negativo.
- **AC-0013-16:** `PATCH /expenses/:id/status` de `PAID` para `OPEN` numa despesa de cartão paga
  pela fatura recebe `409 CREDIT_CARD_EXPENSE_PAID_BY_STATEMENT`.
- **AC-0013-17:** a fatura fechada de total zero tem `overdue: false` mesmo depois do vencimento,
  e pagá-la passa a `PAID` sem mover saldo nem limite; a fatura fechada com valor e não paga tem
  `overdue: true` a partir do dia seguinte ao `dueOn`.
- **AC-0013-18:** um parcelamento em 3× lançado hoje aparece em três faturas na listagem com `to`
  três meses adiante — a corrente e duas projetadas, cada uma com a sua parcela.
- **AC-0013-19:** `VIEWER` lista e consulta e recebe `403 FORBIDDEN` ao pagar e ao desfazer;
  `BILLER` paga; sem perfil, `403 PROFILE_PENDING` (INV-0013-11).

## Test mapping

| Item                                                                                                | Teste                                                               |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| AC-0013-01, INV-0013-09                                                                             | `tests/integration/platform/database/migrations.spec.ts` (extensão) |
| AC-0013-02, AC-0013-03, AC-0013-04, INV-0013-01, INV-0013-03, INV-0013-04                           | `tests/statements/statement-chain.spec.ts`                          |
| AC-0013-05, AC-0013-06, AC-0013-07, INV-0013-07, INV-0013-08                                        | `tests/integration/statements/closing.spec.ts`                      |
| AC-0013-08, AC-0013-17, AC-0013-18, INV-0013-02, ERR-0013-01, ERR-0013-02, ERR-0013-09, ERR-0013-10 | `tests/integration/statements/listing.spec.ts`                      |
| AC-0013-09, AC-0013-10, AC-0013-11, INV-0013-05, ERR-0013-08                                        | `tests/integration/statements/closed-window.spec.ts`                |
| AC-0013-12 a AC-0013-16, INV-0013-06, ERR-0013-03 a ERR-0013-07                                     | `tests/integration/statements/payment.spec.ts`                      |
| AC-0013-19, INV-0013-11                                                                             | `tests/integration/statements/authorization.spec.ts`                |
| INV-0013-10                                                                                         | gate `boundaries`                                                   |

## Open questions

1. **Fuso de "hoje":** a fatura fecha quando `closesOn < hoje` em UTC, a convenção da spec 0012.
   Uma compra às 22h do dia de fechamento, no horário de Brasília, já é o dia seguinte em UTC, e
   seria recusada como janela fechada. A alternativa é fixar `America/Sao_Paulo` como fuso de
   negócio para "hoje" — o que mudaria também o default de `paidOn` da 0012. Decidir.
2. **Despesa anterior ao cartão:** com o primeiro ciclo ancorado no cadastro, uma despesa de
   cartão com data anterior é recusada. Isso impede lançar o histórico de um cartão cadastrado
   hoje, que é exatamente o que a importação da planilha (spec `0016`) fará. Alternativas:
   aceitar um "início do histórico" informado no cartão, ou deixar a importação criar as faturas
   antigas já pagas. Decidir agora ou explicitamente adiar para a `0016`.
3. **Pagamento parcial:** fora de escopo — a fatura se paga inteira. Confirmar que não há uso real
   de pagamento parcial ou rotativo a modelar.
4. **Estorno no cartão:** fora de escopo, porque exigiria despesa de valor negativo. Confirmar se
   estornos acontecem com frequência suficiente para entrar agora.
