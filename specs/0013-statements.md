---
id: '0013'
title: Statements — faturas de cartão, estornos, fechamento e pagamento
status: draft
depends_on: ['0000', '0003', '0004', '0010', '0011', '0012']
---

# 0013 — Statements

## Goal

Dar ao cartão de crédito a fatura: o conjunto dos lançamentos de um ciclo, com total, fechamento,
vencimento e pagamento. Ao final, todo lançamento de cartão pertence a exatamente uma fatura por
regra de data, nunca por ligação manual; o total de uma fatura é sempre derivado, nunca digitado;
uma fatura fechada não muda mais, nem quando o cartão muda de dia de fechamento ou de vencimento;
a fatura se paga como no app do banco — total, mínimo ou valor livre —, e o que não foi pago passa
para a fatura seguinte; e estornos devolvem limite e abatem a fatura em que caem. Todo movimento
de saldo e de limite acontece na mesma transação que o causou.

## Scope / Non-goals

- **Em escopo:** a fatura como entidade; a pertinência lançamento↔fatura pela data de lançamento;
  o encadeamento dos ciclos a partir das faturas já fechadas; o fechamento, inclusive o de
  recuperação quando nenhum job rodou; a imutabilidade da janela fechada, que o módulo `expenses`
  passa a respeitar; o estorno de cartão; o resumo da fatura, por tipo de despesa; o pagamento
  total, parcial ou mínimo a partir de uma conta bancária, a quitação, o saldo que rola para a
  fatura seguinte e o desfazer de um pagamento; o valor mínimo informado; os eventos de fatura e de
  estorno; autorização por perfil; o contrato no `openapi.yaml`.
- **Fora de escopo:** o **cálculo** de juros, multa, IOF e mínimo — o sistema não conhece as regras
  de cada emissor; os encargos entram como despesa de cartão, lançados como aparecem no app do
  banco, e o mínimo é informado; pagamento antecipado de fatura ainda aberta (ver _Open
  questions_); saldo credor devolvido em conta — o crédito só abate faturas seguintes; o
  agendamento do fechamento (FCB-015), que esta spec torna opcional; saldo previsto e relatórios
  (spec `0015`); importação de faturas históricas (spec `0016`); conciliação com o extrato do
  emissor.

## Contracts

### Vocabulário

- **Hoje** é `businessToday()`, no fuso de negócio `America/Sao_Paulo` (spec 0012).
- **Ciclo** é a janela de datas de um cartão, `startsOn` a `closesOn`, fechada nas duas pontas,
  com o seu `dueOn` (spec 0011).
- **Lançamento de cartão** é uma despesa de cartão (spec 0012) ou um estorno (esta spec). Todo
  lançamento tem `occurredOn`, a data do fato, e `postedOn`, a **data de lançamento na fatura**.
- **Fatura** é o ciclo visto como cobrança: os lançamentos daquele cartão com `postedOn` na janela.
- **Fatura aberta** é a do ciclo que ainda não terminou — a de hoje — e as dos ciclos futuros,
  onde caem as parcelas lançadas adiante. Não é persistida: é **projetada** a cada leitura.
- **Fatura fechada** é a de um ciclo cujo `closesOn` já passou. É persistida com as datas
  congeladas, e a sua janela não aceita mais mudança que altere o total.
- **Quitada** (`PAID`) é a fatura fechada que não deve mais nada. **Rolada** (`ROLLED_OVER`) é a
  fatura fechada cujo restante passou para a fatura seguinte.

### Pertinência: o lançamento pertence à fatura pela data de lançamento

Um lançamento de cartão pertence à fatura do mesmo cartão cuja janela contém o seu `postedOn`. É a
regra da planilha legada
([análise, 2.2](https://github.com/bhenriq-souza/finances-control/blob/main/docs/legacy-spreadsheet-analysis.md))
e a resposta à falha mais cara que ela teve: oito ligações manuais fatura↔despesa apontando para o
mês errado (item 3.1). **Não existe coluna, tabela ou endpoint que associe um lançamento a uma
fatura.** A associação é calculada, e por isso não pode ser declarada errada.

`postedOn` separa a data do fato da data em que o banco a cobra, porque elas divergem na vida real:

- **Compra no dia do fechamento** que o banco lança no ciclo seguinte: o lançamento é feito com
  `postedOn` no ciclo seguinte. O sistema não adivinha a regra de cada emissor; o usuário informa,
  como vê no app do banco.
- **Lançamento atrasado:** quando a fatura de `occurredOn` já fechou, o **default** de `postedOn` é
  o primeiro dia da fatura aberta — é o que o banco faz com a cobrança que chega depois do
  fechamento. A regra geral: `postedOn` default é `max(occurredOn, closedThrough + 1 dia)`, com
  `closedThrough` definido em _A janela fechada_.
- **Despesa antiga movida para um cartão novo** (troca de forma de pagamento, spec 0012): cai, pelo
  mesmo default, na fatura aberta do cartão de destino.

Como as janelas de um cartão são contíguas e não se sobrepõem (INV-0011-08), todo `postedOn`
pertence a exatamente uma fatura.

### Encadeamento dos ciclos

A spec 0011 deriva o ciclo da configuração **atual** do cartão. Isso basta para o presente, mas
não para o passado: depois de uma mudança de `closing_day`, o ciclo derivado poderia começar antes
do fechamento já gravado e sobrepor a fatura fechada. Por isso o ciclo seguinte a uma fatura
fechada **continua** de onde ela parou:

- **Primeiro ciclo de um cartão:** `cycleFor(card, createdOn)`, com `createdOn` a data do cadastro
  no fuso de negócio.
- **Ciclo seguinte a uma fatura fechada `f`:** `startsOn = f.closesOn + 1 dia`; `closesOn` e
  `dueOn` são os de `cycleFor(card, startsOn)` com a configuração atual.
- Os ciclos futuros encadeiam da mesma forma, cada um a partir do anterior.

`cycleFor(card, startsOn)` devolve o primeiro fechamento igual ou posterior a `startsOn`, então o
encadeamento nunca deixa buraco nem sobreposição, e uma mudança de `closing_day` produz no máximo
um ciclo mais curto ou mais longo. A função é a da spec 0011, importada de `src/accounts/index.ts`;
esta spec não acrescenta derivação ao `accounts`.

### Modelo

Três tabelas, pelas convenções da [spec 0003](0003-persistence.md). Toda coluna monetária é
`numeric(14,2)` e atravessa o ORM como inteiro de centavos
([ADR-0007](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0007-monetary-representation.md)).

#### `credit_card_statements`

Só a fatura **fechada** é persistida; a aberta é projetada.

| Coluna                    | Tipo            | Regra                                                                       |
| ------------------------- | --------------- | --------------------------------------------------------------------------- |
| `id`                      | `uuid`          | PK, `gen_random_uuid()`                                                     |
| `credit_card_id`          | `uuid`          | not null, FK `credit_cards(id)` `on delete restrict`                        |
| `starts_on`               | `date`          | not null                                                                    |
| `closes_on`               | `date`          | not null                                                                    |
| `due_on`                  | `date`          | not null                                                                    |
| `status`                  | `text`          | not null, `ck_credit_card_statements_status`: `CLOSED`/`PAID`/`ROLLED_OVER` |
| `previous_balance_cents`  | `numeric(14,2)` | not null — o restante da fatura anterior no registro, ver _Fechamento_      |
| `minimum_payment_cents`   | `numeric(14,2)` | nullable, `ck_credit_card_statements_minimum_payment` ≥ 0                   |
| `closed_at`               | `timestamptz`   | not null — quando o fechamento foi registrado                               |
| `created_at`/`updated_at` | `timestamptz`   | convenções da spec 0003                                                     |

- `uq_credit_card_statements_credit_card_id_closes_on` sobre `(credit_card_id, closes_on)` e
  `uq_credit_card_statements_credit_card_id_starts_on` sobre `(credit_card_id, starts_on)`.
- `ck_credit_card_statements_dates`: `starts_on <= closes_on` e `closes_on < due_on`.

#### `credit_card_statement_payments`

| Coluna                    | Tipo            | Regra                                                          |
| ------------------------- | --------------- | -------------------------------------------------------------- |
| `id`                      | `uuid`          | PK                                                             |
| `statement_id`            | `uuid`          | not null, FK `credit_card_statements(id)` `on delete restrict` |
| `bank_account_id`         | `uuid`          | not null, FK `bank_accounts(id)` `on delete restrict`          |
| `amount_cents`            | `numeric(14,2)` | not null, `ck_credit_card_statement_payments_amount` > 0       |
| `paid_on`                 | `date`          | not null                                                       |
| `created_at`/`updated_at` | `timestamptz`   | convenções da spec 0003                                        |

Índice `idx_credit_card_statement_payments_statement_id`.

#### `credit_card_refunds`

| Coluna                    | Tipo            | Regra                                                        |
| ------------------------- | --------------- | ------------------------------------------------------------ |
| `id`                      | `uuid`          | PK                                                           |
| `credit_card_id`          | `uuid`          | not null, FK `credit_cards(id)` `on delete restrict`         |
| `expense_id`              | `uuid`          | nullable, FK `expenses(id)` `on delete set null`             |
| `description`             | `text`          | not null                                                     |
| `amount_cents`            | `numeric(14,2)` | not null, `ck_credit_card_refunds_amount` > 0                |
| `occurred_on`             | `date`          | not null                                                     |
| `posted_on`               | `date`          | not null, `ck_credit_card_refunds_posted_on` ≥ `occurred_on` |
| `notes`                   | `text`          | nullable                                                     |
| `created_at`/`updated_at` | `timestamptz`   | convenções da spec 0003                                      |

Índice `idx_credit_card_refunds_credit_card_id_posted_on`.

**Não há coluna de total nem de valor pago.** Total, valor devido, pago e restante são calculados
a cada leitura (planilha legada, item 3.2: o total digitado divergiu do calculado em duas de três
faturas). A única grandeza monetária gravada pela fatura é `previous_balance_cents`, escrita pelo
sistema no registro do fechamento e nunca por um cliente: ela congela um valor que, depois do
registro, não pode mais mudar (ver _Fechamento_). As FKs para tabelas de outros módulos são
constraints de banco, não acesso de código (ADR-0003, regra 2).

### Valores de uma fatura

| Campo                  | Definição                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `purchasesCents`       | soma das despesas da janela em `OPEN`, `VERIFYING` ou `PAID` — `FORECAST` fica de fora  |
| `refundsCents`         | soma dos estornos da janela                                                             |
| `totalCents`           | `purchasesCents − refundsCents`; pode ser negativo                                      |
| `previousBalanceCents` | o que veio da fatura anterior: positivo se ela rolou dívida, negativo se deixou crédito |
| `amountDueCents`       | `totalCents + previousBalanceCents`                                                     |
| `paidCents`            | soma dos pagamentos da fatura                                                           |
| `remainingCents`       | `amountDueCents − paidCents`                                                            |
| `minimumPaymentCents`  | o mínimo informado, ou `null`                                                           |

- `byExpenseType` agrupa `purchasesCents` por tipo de despesa, como a planilha fazia (análise,
  2.2): lista de `{ expenseTypeId, name, totalCents }`, ordenada por `totalCents` decrescente e
  depois por `name`. A soma dos grupos é igual a `purchasesCents`, sempre.
- Na fatura aberta corrente, `previousBalanceCents` é o restante **atual** da última fatura
  fechada, se ela ainda está `CLOSED` — um valor provisório, que só se congela quando a corrente
  fecha. Nas faturas futuras projetadas, é `0`.

### Fechamento

Uma fatura **está fechada** quando `closesOn < hoje`. Fechar não é uma ação de alguém: é a
passagem do dia de fechamento. O que esta spec define é quando esse fato é **registrado** — a linha
em `credit_card_statements` e o evento `StatementClosed`:

- `StatementService.closeDue(asOf: Date, creditCardId?: string): Promise<number>` registra, para
  um cartão ou para todos, cada ciclo encadeado com `closesOn < asOf` que ainda não tem linha, em
  ordem cronológica, e devolve quantos registrou. Uma segunda chamada com o mesmo `asOf` devolve
  `0`.
- Ao registrar a fatura `N`, com `P` a fatura persistida anterior:
    - `previous_balance_cents` de `N` recebe o `remainingCents` de `P` naquele instante, se `P`
      está `CLOSED` (dívida que rola) ou `PAID` com restante negativo (crédito que rola); senão,
      `0`. Na primeira fatura do cartão, `0`.
    - `P` em `CLOSED` passa a `ROLLED_OVER`: deixa de aceitar pagamento, e o seu restante agora é
      cobrado em `N`. É o rotativo — os juros que o banco cobra sobre ele entram como despesa de
      cartão, lançada pelo usuário.
    - `N` nasce `PAID` se `amountDueCents <= 0` — nada a pagar —, e `CLOSED` caso contrário.
- Cada cartão é registrado numa transação própria (`TransactionRunner.run`, spec 0004), sob
  `pg_advisory_xact_lock` sobre o id do cartão — o mesmo lock que toda escrita deste módulo num
  cartão toma. Duas chamadas concorrentes nunca registram o mesmo ciclo duas vezes.
  `StatementClosed` é publicado uma vez por fatura registrada.
- **Quem chama:** o job diário do FCB-015, quando existir, e **toda operação deste módulo sobre um
  cartão**, antes de responder — leitura, pagamento, estorno e desfazer chamam
  `closeDue(hoje, creditCardId)` primeiro. A corretude nunca depende de o job ter rodado: sem ele,
  o registro só acontece mais tarde, e `closedAt` diz quando.
- Cartão arquivado também fecha: a fatura de um cartão cancelado continua sendo cobrada.

### A janela fechada

O total de uma fatura fechada não pode mudar: ele já foi cobrado, já pode ter sido pago em parte, e
já pode ter rolado para a fatura seguinte. Como a pertinência é por data, proteger a fatura é
proteger a **janela**: toda data até o `closesOn` da última fatura fechada do cartão está fechada —
inclusive as anteriores ao primeiro ciclo.

O módulo `expenses` não pode importar `statements` — é `statements` que lê `expenses` — e a regra
precisa valer dentro da transação da despesa. Por isso a dependência é invertida, como a spec 0004
faz com os subscribers:

```ts
// declarado por expenses, em src/expenses/index.ts
interface StatementPeriodGuard {
    /** Último dia fechado do cartão; postedOn até ele, inclusive, está em fatura fechada. */
    closedThrough(manager: EntityManager, creditCardId: string): Promise<Date>;
}
```

- `expenses` declara a porta e o símbolo `StatementPeriodGuardSymbol`, consulta-a em toda escrita
  de despesa de cartão e calcula com ela o default de `postedOn`. Até `statements` existir, o
  container registra o `OpenPeriodGuard` do próprio `expenses`, que devolve uma data mínima: nada
  fechado, e `postedOn` default igual a `occurredOn` (AC-0012-21).
- `statements` implementa a porta em `StatementPeriodGuardService`, que passa a ser a
  implementação registrada na composição (`src/container.ts`). Nenhum import cruza de `expenses`
  para `statements`.
- `closedThrough` **não escreve**: é o `closesOn` do último ciclo encadeado com `closesOn < hoje`,
  persistido ou não; se nenhum ciclo passou, é o dia anterior ao primeiro ciclo. Vale mesmo antes
  de `closeDue` registrar o fechamento do dia.

Com `d = closedThrough`, um lançamento está **na janela fechada** quando o seu `postedOn <= d`:

| Operação                                                                                                   | Regra                                          |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Criar com `postedOn` informado `<= d`                                                                      | recusado (`ERR-0013-08`)                       |
| Criar sem `postedOn`                                                                                       | aceito — o default nunca cai na janela fechada |
| Na janela fechada: alterar `amountCents`, `occurredOn` ou `postedOn`                                       | recusado (`ERR-0013-08`)                       |
| Fora dela: alterar `postedOn` para `<= d`                                                                  | recusado (`ERR-0013-08`)                       |
| Na janela fechada: `FORECAST → OPEN`                                                                       | recusado (`ERR-0013-08`)                       |
| Na janela fechada: excluir despesa `OPEN` ou `VERIFYING`, ou estorno                                       | recusado (`ERR-0013-08`)                       |
| Na janela fechada: trocar a forma de pagamento (spec 0012)                                                 | recusado; num grupo, a parcela fica onde está  |
| Na janela fechada: excluir `FORECAST`, `OPEN ↔ VERIFYING`, alterar `description`, `expenseTypeId`, `notes` | aceito — não muda o total                      |

Alterar `expenseTypeId` muda o `byExpenseType` de uma fatura fechada, não o seu total; é correção
de classificação. Na exclusão e na troca de forma de pagamento de um grupo de parcelas (spec 0012),
a parcela em janela fechada é tratada como paga: permanece.

### Estornos

O estorno é o lançamento de cartão que **devolve**: a compra cancelada, a cobrança contestada e
ganha, o cashback creditado. Ele não é despesa de valor negativo — a spec 0012 exige valor positivo
e despesa é o que sai —, é entidade própria deste módulo, em `credit_card_refunds`.

- `POST /credit-card-refunds` com
  `{ creditCardId, description, amountCents, occurredOn, postedOn?, expenseId?, notes? }`.
  `postedOn` segue a regra de toda data de lançamento: default
  `max(occurredOn, closedThrough + 1 dia)`, e o informado não pode cair na janela fechada.
- **Limite na mesma transação:** criar devolve `amountCents` ao limite disponível
  (`applyAvailableLimitDelta(+amountCents)`); excluir consome de novo. O estorno abate o
  `totalCents` da fatura em que cai.
- `expenseId` é opcional e aponta a compra estornada, que precisa ser despesa **do mesmo cartão**
  (`ERR-0013-13`); a soma dos estornos de uma despesa não passa do valor dela (`ERR-0013-14`). A
  ligação é informativa: o estorno não muda o status nem o valor da despesa, e cai na fatura do
  seu próprio `postedOn` — o banco estorna na fatura corrente, não na da compra.
- Cartão arquivado aceita estorno: o crédito de um cartão cancelado ainda chega.
- `PATCH /credit-card-refunds/:id` aceita só `description` e `notes`; para corrigir valor ou data,
  exclui-se e lança-se de novo, se a janela estiver aberta.
- Um estorno maior que as compras da fatura deixa `totalCents` negativo; a fatura fecha `PAID` se
  o devido for `<= 0`, e o crédito rola para a seguinte (ver _Fechamento_).

### Pagamento

Como no app do banco, a fatura fechada se paga com o **valor total**, com o **mínimo** ou com um
**valor livre** — para o backend, os três são um `amountCents` entre 1 e `remainingCents`; a
escolha é do cliente, que tem os dois números na resposta. Uma fatura aceita vários pagamentos.

`POST /statements/:id/payments` com `{ bankAccountId, amountCents, paidOn? }`. `paidOn` é opcional,
default hoje, posterior a `closesOn` e não posterior a hoje. Numa única transação, sob o lock do
cartão e com lock de escrita na linha da fatura:

1. A fatura precisa estar `CLOSED`: `PAID` recebe `ERR-0013-03`, `ROLLED_OVER` recebe
   `ERR-0013-11` — o restante dela está na fatura seguinte, e é lá que se paga. `amountCents`
   maior que `remainingCents` recebe `ERR-0013-04`: não há pagamento a maior. A conta precisa
   existir e não estar arquivada (`ERR-0013-05`, `ERR-0013-06`).
2. Grava o pagamento.
3. `BankAccountService.applyBalanceDelta(manager, bankAccountId, −amountCents)` debita a conta.
4. `CreditCardService.applyAvailableLimitDelta(manager, creditCardId, +amountCents)` libera o
   limite — cada real pago volta ao disponível, como no cartão real.
5. Publica `StatementPaymentRegistered`.
6. **Quitação:** se `remainingCents` chegou a `0`, a fatura passa a `PAID`; as despesas da cadeia
   em `OPEN` ou `VERIFYING` passam a `PAID` com o `paidOn` deste pagamento
   (`ExpenseService.markPaidByStatement`); publica `StatementPaid`. A **cadeia** é a janela da
   própria fatura somada às janelas das faturas `ROLLED_OVER` imediatamente anteriores, cujo
   restante ela absorveu — como as janelas são contíguas, é um intervalo único de datas.

O saldo da conta pode ficar negativo e o pagamento é aceito mesmo assim (INV-0012-09). Cartão
arquivado não impede o pagamento. Pagamento parcial não marca despesa como paga: uma despesa só é
`PAID` quando a dívida que a contém foi quitada.

**Mínimo.** `PATCH /statements/:id` com `{ minimumPaymentCents }` grava o mínimo que o app do banco
mostra, numa fatura `CLOSED`; ele não pode passar de `amountDueCents`. O sistema não o calcula —
cada emissor tem a sua regra. O mínimo só serve à resposta e ao cálculo de vencida.

**Desfazer.** `DELETE /statements/:id/payments/:paymentId` desfaz **o último pagamento** da fatura,
e só enquanto a fatura seguinte não foi registrada — depois disso o restante já foi congelado nela
(`ERR-0013-12`). Na mesma transação e na ordem inversa: se a fatura estava `PAID`, volta a
`CLOSED` e as despesas da cadeia em `PAID` voltam a `OPEN` com `paid_on` nulo
(`ExpenseService.markUnpaidByStatement`); a conta recebe `+amountCents`; o limite é consumido com
`−amountCents`; o pagamento é apagado. Desfazer não publica evento, como o desfazer da spec 0012.
Uma despesa que estava em `VERIFYING` volta como `OPEN`: a quitação encerrou a conferência.

### Interface pública que esta spec acrescenta ao `expenses`

A spec 0012 deixou para cá o contrato de `markPaidByStatement`. `src/expenses/index.ts` passa a
exportar:

```ts
type PostingWindow = { from: Date; to: Date }; // postedOn, inclusivos

ExpenseService.markPaidByStatement(
    manager: EntityManager, creditCardId: string, window: PostingWindow, paidOn: Date,
): Promise<{ count: number }>

ExpenseService.markUnpaidByStatement(
    manager: EntityManager, creditCardId: string, window: PostingWindow,
): Promise<{ count: number }>

ExpenseService.listByCreditCard(
    creditCardId: string, window: PostingWindow, manager?: EntityManager,
): Promise<CardExpenseSummary[]>

ExpenseService.findCardExpense(
    manager: EntityManager, id: string,
): Promise<{ id: string; creditCardId: string; amountCents: number } | null>

type CardExpenseSummary = {
    id: string; description: string; occurredOn: string; postedOn: string;
    amountCents: number; status: ExpenseStatus; expenseType: { id: string; name: string };
    installment: { groupId: string; number: number; total: number } | null;
};

interface StatementPeriodGuard { /* acima */ }
const StatementPeriodGuardSymbol: unique symbol;
```

- `listByCreditCard` substitui a assinatura da spec 0012, filtrando por `postedOn`.
  `findCardExpense` devolve `null` para despesa inexistente ou de conta.
- Os `mark*` escrevem com o `manager` recebido e nunca abrem transação (INV-0004-03), não publicam
  evento e não tocam saldo nem limite — isso é do pagamento, aqui.
- `PATCH /expenses/:id/status` de `PAID → OPEN` em despesa de **cartão** é recusado com
  `409 CREDIT_CARD_EXPENSE_PAID_BY_STATEMENT` (ERR-0012-09): despesa quitada pela fatura só se
  despaga desfazendo o pagamento da fatura.

### Eventos

Declarados em `src/events/statements.events.ts` (spec 0004). Datas em `YYYY-MM-DD`.

```ts
export const STATEMENT_CLOSED = 'StatementClosed' as const;
export type StatementClosed = DomainEvent<
    typeof STATEMENT_CLOSED,
    {
        statementId: string;
        creditCardId: string;
        startsOn: string;
        closesOn: string;
        dueOn: string;
        totalCents: number;
        previousBalanceCents: number;
        amountDueCents: number;
    }
>;

export const STATEMENT_PAYMENT_REGISTERED = 'StatementPaymentRegistered' as const;
export type StatementPaymentRegistered = DomainEvent<
    typeof STATEMENT_PAYMENT_REGISTERED,
    {
        statementId: string;
        paymentId: string;
        creditCardId: string;
        bankAccountId: string;
        amountCents: number;
        paidOn: string;
        remainingCents: number;
    }
>;

export const STATEMENT_PAID = 'StatementPaid' as const;
export type StatementPaid = DomainEvent<
    typeof STATEMENT_PAID,
    { statementId: string; creditCardId: string; paidOn: string }
>;

export const CREDIT_CARD_REFUND_REGISTERED = 'CreditCardRefundRegistered' as const;
export type CreditCardRefundRegistered = DomainEvent<
    typeof CREDIT_CARD_REFUND_REGISTERED,
    {
        refundId: string;
        creditCardId: string;
        expenseId: string | null;
        amountCents: number;
        occurredOn: string;
        postedOn: string;
    }
>;
```

- `StatementClosed` é o nome que o ADR-0005 já usa, publicado no **registro** do fechamento.
- `StatementPaid` sai na quitação — por pagamento ou pelo fechamento com devido `<= 0`.
- Nenhum módulo consome estes eventos nesta spec.

### Quem pode o quê

"Gerenciar faturas" é do `BILLER` pelos
[perfis do produto](https://github.com/bhenriq-souza/finances-control/blob/main/docs/user-profiles.md);
o `ADMIN` também escreve, pela mesma razão da spec 0012.

| Operação                                                             | `ADMIN` | `BILLER` | `VIEWER` |
| -------------------------------------------------------------------- | ------- | -------- | -------- |
| Pagar, desfazer pagamento, informar mínimo, lançar e excluir estorno | sim     | sim      | não      |
| Listar e consultar faturas e estornos                                | sim     | sim      | sim      |

Fechar não tem operação: é a passagem do tempo.

### Endpoints

| Método   | Rota                                  | Perfil            |
| -------- | ------------------------------------- | ----------------- |
| `GET`    | `/statements`                         | qualquer          |
| `GET`    | `/statements/current`                 | qualquer          |
| `GET`    | `/statements/:id`                     | qualquer          |
| `PATCH`  | `/statements/:id`                     | `ADMIN`, `BILLER` |
| `POST`   | `/statements/:id/payments`            | `ADMIN`, `BILLER` |
| `DELETE` | `/statements/:id/payments/:paymentId` | `ADMIN`, `BILLER` |
| `POST`   | `/credit-card-refunds`                | `ADMIN`, `BILLER` |
| `GET`    | `/credit-card-refunds`                | qualquer          |
| `GET`    | `/credit-card-refunds/:id`            | qualquer          |
| `PATCH`  | `/credit-card-refunds/:id`            | `ADMIN`, `BILLER` |
| `DELETE` | `/credit-card-refunds/:id`            | `ADMIN`, `BILLER` |

- **`GET /statements?creditCardId=…&from=…&to=…`** devolve as faturas do cartão com `closesOn`
  entre `from` e `to` (`YYYY-MM-DD`, inclusivos), fechadas e projetadas, em ordem de `closesOn`.
  `creditCardId` é obrigatório; sem `from` e `to`, as fechadas dos últimos doze meses e a aberta
  corrente. A janela cobre no máximo 120 faturas, o maior parcelamento da spec 0012
  (`ERR-0013-10`). A listagem não traz `expenses`, `refunds` nem `payments`.
- **`GET /statements/current?creditCardId=…`** devolve a fatura aberta de hoje, com o detalhe.
- **`GET /statements/:id`** devolve uma fatura persistida, com o detalhe. A projetada não tem `id`
  e só se lê pelas duas rotas acima.
- **`GET /credit-card-refunds`** aceita `creditCardId`, `expenseId`, `from` e `to` (`postedOn`),
  todos opcionais, em ordem de `postedOn`.

### Corpos

```
StatementResponse {
    id,                         // null na projetada
    creditCardId,
    status,                     // 'OPEN' (projetada) | 'CLOSED' | 'PAID' | 'ROLLED_OVER'
    startsOn, closesOn, dueOn,
    purchasesCents, refundsCents, totalCents,
    previousBalanceCents, amountDueCents, paidCents, remainingCents,
    minimumPaymentCents,        // null se não informado
    overdue,
    closedAt,                   // null na projetada
    byExpenseType: [{ expenseTypeId, name, totalCents }],
    expenses?: CardExpenseSummary[],      // detalhe, em ordem de postedOn
    refunds?: CreditCardRefundResponse[], // detalhe, em ordem de postedOn
    payments?: [{ id, bankAccountId, amountCents, paidOn, createdAt }]  // detalhe
}
CreditCardRefundResponse { id, creditCardId, expenseId, description, amountCents,
                           occurredOn, postedOn, notes, createdAt, updatedAt }
```

- `OPEN` não é persistido: é o status de toda fatura projetada.
- **Vencida** é derivado, não status: `overdue` é verdadeiro na fatura `CLOSED` com `dueOn < hoje`
  e `paidCents` menor que `minimumPaymentCents` — ou que `amountDueCents`, sem mínimo informado.
  Pagar o mínimo tira a fatura do atraso, como no banco; o restante rola no fechamento seguinte.
  Nenhuma varredura muda status de fatura.
- Datas de negócio em `YYYY-MM-DD`; dinheiro em inteiro de centavos com sufixo `Cents`.

### Interface pública do módulo

`src/statements/index.ts` exporta as classes de rota e controller, `StatementService.closeDue` para
o job do FCB-015 e `StatementPeriodGuardService` para a composição. `reporting` (spec `0015`) lê as
três tabelas por consulta própria (ADR-0003, regra 5) — o pagamento de fatura é a saída de caixa
que o saldo previsto precisa enxergar.

## Invariants

- **INV-0013-01:** todo lançamento de cartão pertence a exatamente uma fatura do seu cartão,
  determinada só pelo `postedOn`; não existe associação gravada entre lançamento e fatura.
- **INV-0013-02:** `totalCents` é sempre `purchasesCents − refundsCents`, derivados dos
  lançamentos; nenhum valor da fatura é informado por cliente, salvo o mínimo; a soma de
  `byExpenseType` é igual a `purchasesCents`.
- **INV-0013-03:** as faturas de um cartão, persistidas e projetadas, são contíguas e não se
  sobrepõem, mesmo depois de mudanças de `closing_day` (estende INV-0011-08).
- **INV-0013-04:** uma fatura fechada tem `startsOn`, `closesOn` e `dueOn` congelados: alterar
  `closing_day` ou `due_day` do cartão nunca os muda (completa INV-0011-07).
- **INV-0013-05:** nenhuma operação muda o total de uma fatura fechada: a janela até o último dia
  fechado não aceita lançamento novo, mudança de valor ou de data, confirmação, troca de forma de
  pagamento nem exclusão de lançamento que conte no total.
- **INV-0013-06:** cada pagamento debita a conta e libera o limite pelo mesmo valor na **mesma
  transação**; a quitação marca as despesas da cadeia como pagas na mesma transação do pagamento
  que quitou; o desfazer reverte tudo na mesma transação (ADR-0003, regra 4).
- **INV-0013-07:** cada ciclo é registrado como fechado no máximo uma vez, e `StatementClosed` é
  publicado exatamente uma vez por fatura registrada.
- **INV-0013-08:** a corretude do fechamento não depende de job: uma fatura cujo `closesOn` passou
  está fechada para a regra da janela e é registrada na primeira operação do módulo sobre o
  cartão.
- **INV-0013-09:** `amountDueCents = totalCents + previousBalanceCents`; `previous_balance_cents`
  é o restante da fatura anterior no registro, escrito só pelo sistema; nenhum pagamento leva
  `remainingCents` abaixo de zero.
- **INV-0013-10:** fatura `ROLLED_OVER` não aceita pagamento nem desfazer, e o seu restante está
  inteiro, e uma vez só, no `previousBalanceCents` da fatura seguinte.
- **INV-0013-11:** o estorno devolve limite na mesma transação em que é lançado e o consome de novo
  na mesma transação em que é excluído; a soma dos estornos de uma despesa nunca passa do valor
  dela.
- **INV-0013-12:** `statements` não lê nem escreve `expenses`, `credit_cards` e `bank_accounts`
  senão pela interface pública dos módulos donos; `expenses` não importa `statements` (ADR-0003,
  regras 1–3). Verificado pelo gate `boundaries`.
- **INV-0013-13:** escrita exige `ADMIN` ou `BILLER`; leitura, qualquer perfil (spec 0010).

## Error cases

| Situação                                                                                                                    | Comportamento exigido                                                                         |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **ERR-0013-01** `:id` ou `:paymentId` inexistente                                                                           | `404`, `STATEMENT_NOT_FOUND`, `STATEMENT_PAYMENT_NOT_FOUND` ou `CREDIT_CARD_REFUND_NOT_FOUND` |
| **ERR-0013-02** `creditCardId` ausente na listagem de faturas ou na corrente                                                | `400`, `VALIDATION_ERROR` citando o campo                                                     |
| **ERR-0013-03** Pagar, ou informar mínimo, em fatura `PAID`                                                                 | `409`, `STATEMENT_ALREADY_PAID`                                                               |
| **ERR-0013-04** `amountCents` maior que `remainingCents`                                                                    | `409`, `STATEMENT_PAYMENT_EXCEEDS_REMAINING`, mensagem com o restante                         |
| **ERR-0013-05** `bankAccountId`, `creditCardId` ou `expenseId` inexistente                                                  | `404`, `BANK_ACCOUNT_NOT_FOUND`, `CREDIT_CARD_NOT_FOUND` ou `EXPENSE_NOT_FOUND`               |
| **ERR-0013-06** Pagar com conta arquivada                                                                                   | `409`, `BANK_ACCOUNT_ARCHIVED`                                                                |
| **ERR-0013-07** `paidOn` igual ou anterior a `closesOn`, ou posterior a hoje                                                | `400`, `VALIDATION_ERROR` citando o campo                                                     |
| **ERR-0013-08** Escrita que mudaria o total de uma janela fechada                                                           | `409`, `STATEMENT_CLOSED`, mensagem com o último dia fechado                                  |
| **ERR-0013-09** `from` > `to` em listagem                                                                                   | `400`, `VALIDATION_ERROR`                                                                     |
| **ERR-0013-10** Janela da listagem com mais de 120 faturas                                                                  | `400`, `VALIDATION_ERROR`                                                                     |
| **ERR-0013-11** Pagar, ou informar mínimo, em fatura `ROLLED_OVER`                                                          | `409`, `STATEMENT_ROLLED_OVER`                                                                |
| **ERR-0013-12** Desfazer pagamento que não é o último, ou depois de a seguinte ser registrada                               | `409`, `STATEMENT_PAYMENT_LOCKED`                                                             |
| **ERR-0013-13** Estorno apontando despesa de conta ou de outro cartão                                                       | `409`, `REFUND_EXPENSE_MISMATCH`                                                              |
| **ERR-0013-14** Estornos de uma despesa somando mais que ela                                                                | `409`, `REFUND_EXCEEDS_EXPENSE`, mensagem com o valor ainda estornável                        |
| **ERR-0013-15** `amountCents` ≤ 0 ou não inteiro; `postedOn` anterior a `occurredOn`; mínimo negativo ou maior que o devido | `400`, `VALIDATION_ERROR` citando o campo                                                     |
| **ERR-0013-16** `PATCH` de estorno com campo além de `description` e `notes`                                                | `400`, `VALIDATION_ERROR` citando o campo recusado                                            |

## Acceptance criteria

- **AC-0013-01:** a migration cria as três tabelas com as constraints nomeadas; aplica e reverte
  num banco limpo.
- **AC-0013-02:** num cartão que fecha dia 10, lançamentos com `postedOn` 10/03, 11/03 e 10/04 caem
  em faturas diferentes: o de 10/03 na que fecha em 10/03, os outros dois na que fecha em 10/04; uma
  compra de 10/03 lançada com `postedOn` 11/03 cai na de 10/04 (INV-0013-01).
- **AC-0013-03:** com a fatura de 10/03 fechada, mudar `closing_day` para 5 faz a seguinte ir de
  11/03 a 05/04; mudar para 25, de 11/03 a 25/03; em nenhum caso a fechada muda de datas ou alguma
  data fica sem fatura (INV-0013-03, INV-0013-04).
- **AC-0013-04:** mudar `due_day` depois do fechamento mantém o `dueOn` da fechada e muda o da
  aberta — o caso real do Santander, de dia 5 para dia 3 (análise, 3.6).
- **AC-0013-05:** `closeDue(asOf)` num cartão sem registro e com três ciclos passados registra três
  faturas em ordem, publica três `StatementClosed` depois do commit, e uma segunda chamada devolve
  `0`; duas chamadas concorrentes registram cada ciclo uma vez só (INV-0013-07).
- **AC-0013-06:** sem job nenhum ter rodado, `GET /statements?creditCardId=…` depois do fechamento
  já mostra a fatura `CLOSED`, com `closedAt` do momento da leitura (INV-0013-08).
- **AC-0013-07:** com a fatura de 10/03 fechada, uma despesa de cartão criada hoje com
  `occurredOn` 05/03 e sem `postedOn` nasce com `postedOn` 11/03 e cai na fatura aberta; com
  `postedOn` 05/03 informado, recebe `409 STATEMENT_CLOSED`.
- **AC-0013-08:** uma despesa de conta `OPEN` de janeiro, trocada para um cartão cadastrado em
  março, cai na fatura aberta do cartão e abate o limite (spec 0012, troca de forma de pagamento).
- **AC-0013-09:** a fatura com despesas de 1000 (`OPEN`), 500 (`VERIFYING`) e 300 (`FORECAST`) e um
  estorno de 200 tem `purchasesCents` 1500, `refundsCents` 200, `totalCents` 1300, e
  `byExpenseType` soma 1500 (INV-0013-02).
- **AC-0013-10:** numa janela fechada, criar com `postedOn` informado nela, alterar `amountCents`,
  `occurredOn` ou `postedOn`, confirmar `FORECAST`, trocar a forma de pagamento e excluir despesa
  `OPEN` ou estorno recebem `409 STATEMENT_CLOSED`; alterar `description`, alternar
  `OPEN ↔ VERIFYING` e excluir `FORECAST` são aceitos; mover o `postedOn` de uma despesa aberta
  para dentro da janela fechada também é recusado (INV-0013-05).
- **AC-0013-11:** num parcelamento de cartão em 3× com a parcela 1 em janela fechada, excluir a
  parcela 2 exclui as parcelas 2 e 3 e mantém a 1.
- **AC-0013-12:** lançar um estorno de 300 devolve 300 ao limite disponível e abate 300 da fatura
  aberta; excluí-lo consome os 300 de novo; estornar 600 de uma despesa de 500 recebe
  `409 REFUND_EXCEEDS_EXPENSE`; estornar despesa de outro cartão recebe
  `409 REFUND_EXPENSE_MISMATCH` (INV-0013-11).
- **AC-0013-13:** pagar 1500 de uma fatura de 1500 a partir de uma conta com saldo 10000 deixa o
  saldo em 8500, devolve 1500 ao limite, passa a fatura a `PAID`, marca as despesas `OPEN` e
  `VERIFYING` como `PAID` com o `paidOn` do pagamento, deixa a `FORECAST` intacta e publica
  `StatementPaymentRegistered` e `StatementPaid` (INV-0013-06).
- **AC-0013-14:** pagar 400 de uma fatura de 1500 debita 400, libera 400 de limite, deixa
  `remainingCents` 1100 e a fatura `CLOSED`, sem marcar despesa como paga; pagar 1100 em seguida
  quita; pagar 1600 de uma fatura de 1500 recebe `409 STATEMENT_PAYMENT_EXCEEDS_REMAINING`.
- **AC-0013-15:** uma fatura de 1500 com 400 pagos rola no fechamento seguinte: passa a
  `ROLLED_OVER`, a nova nasce com `previousBalanceCents` 1100 e `amountDueCents` igual ao seu total
  mais 1100; pagar a rolada recebe `409 STATEMENT_ROLLED_OVER`; quitar a nova marca como pagas as
  despesas das duas janelas (INV-0013-09, INV-0013-10).
- **AC-0013-16:** uma fatura cujos estornos superam as compras em 200 fecha `PAID`, publica
  `StatementPaid`, e a seguinte nasce com `previousBalanceCents` −200.
- **AC-0013-17:** com `minimumPaymentCents` 300 informado e vencimento passado, a fatura está
  `overdue` com 200 pagos e deixa de estar com 300; sem mínimo, só sai do atraso quitada; a fatura
  quitada nunca está `overdue`; mínimo maior que o devido recebe `400`.
- **AC-0013-18:** se qualquer passo de um pagamento falhar, nem a conta, nem o cartão, nem as
  despesas, nem a fatura mudam, e nenhum evento é publicado (INV-0013-06).
- **AC-0013-19:** desfazer o último pagamento da fatura quitada devolve o valor à conta, consome o
  limite, volta a fatura a `CLOSED` e as despesas a `OPEN` com `paidOn` nulo; desfazer um pagamento
  que não é o último, ou depois de a seguinte ser registrada, recebe
  `409 STATEMENT_PAYMENT_LOCKED`.
- **AC-0013-20:** pagar com conta arquivada recebe `409 BANK_ACCOUNT_ARCHIVED`; com `paidOn` igual
  ao `closesOn` ou amanhã, `400`; com saldo insuficiente, é aceito e o saldo fica negativo.
- **AC-0013-21:** `PATCH /expenses/:id/status` de `PAID` para `OPEN` numa despesa de cartão
  quitada pela fatura recebe `409 CREDIT_CARD_EXPENSE_PAID_BY_STATEMENT`.
- **AC-0013-22:** um parcelamento em 3× lançado hoje aparece em três faturas na listagem com `to`
  três meses adiante — a corrente e duas projetadas, cada uma com a sua parcela.
- **AC-0013-23:** `VIEWER` lista e consulta faturas e estornos e recebe `403 FORBIDDEN` em toda
  escrita; `BILLER` paga e estorna; sem perfil, `403 PROFILE_PENDING` (INV-0013-13).

## Test mapping

| Item                                                                                                | Teste                                                               |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| AC-0013-01                                                                                          | `tests/integration/platform/database/migrations.spec.ts` (extensão) |
| AC-0013-02, AC-0013-03, AC-0013-04, INV-0013-01, INV-0013-03, INV-0013-04                           | `tests/statements/statement-chain.spec.ts`                          |
| AC-0013-05, AC-0013-06, INV-0013-07, INV-0013-08                                                    | `tests/integration/statements/closing.spec.ts`                      |
| AC-0013-07, AC-0013-08, AC-0013-10, AC-0013-11, AC-0013-21, INV-0013-05, ERR-0013-08                | `tests/integration/statements/closed-window.spec.ts`                |
| AC-0013-12, INV-0013-11, ERR-0013-13, ERR-0013-14, ERR-0013-16                                      | `tests/integration/statements/refunds.spec.ts`                      |
| AC-0013-09, AC-0013-17, AC-0013-22, INV-0013-02, ERR-0013-01, ERR-0013-02, ERR-0013-09, ERR-0013-10 | `tests/integration/statements/listing.spec.ts`                      |
| AC-0013-13, AC-0013-14, AC-0013-18, AC-0013-20, INV-0013-06, ERR-0013-03 a ERR-0013-07, ERR-0013-15 | `tests/integration/statements/payment.spec.ts`                      |
| AC-0013-15, AC-0013-16, AC-0013-19, INV-0013-09, INV-0013-10, ERR-0013-11, ERR-0013-12              | `tests/integration/statements/rollover.spec.ts`                     |
| AC-0013-23, INV-0013-13                                                                             | `tests/integration/statements/authorization.spec.ts`                |
| INV-0013-12                                                                                         | gate `boundaries`                                                   |

## Open questions

1. **Pagamento antecipado:** os apps de banco deixam pagar a fatura aberta antes do fechamento,
   liberando limite na hora. Esta spec só aceita pagamento de fatura fechada. Entra agora — o
   pagamento passaria a abater a fatura aberta e a rolar como crédito no fechamento — ou fica para
   depois?
2. **Mínimo informado:** o mínimo é digitado pelo usuário a partir do app do banco, porque cada
   emissor tem a sua regra. A alternativa é um percentual configurável por cartão (o mercado usa
   15%), calculado pelo sistema, o que exigiria campo novo no `accounts` (spec 0011, já
   implementada). Confirmar o informado.
