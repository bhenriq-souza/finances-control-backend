---
id: '0015'
title: Reporting — saldo realizado, saldo previsto e relatórios
status: draft
depends_on: ['0000', '0003', '0010', '0011', '0012', '0013', '0014']
---

# 0015 — Reporting

## Goal

Responder às perguntas que atravessam os módulos: quanto há em cada conta em qualquer data do
passado, quanto haverá ao fim de cada mês futuro, quanto se gastou e recebeu por categoria ao longo
do tempo, e quanto dinheiro de fato entrou e saiu. Ao final, o saldo previsto do F002 tem uma regra
de composição **única**, implementada uma vez e usada por todos os relatórios (planilha legada,
item 3.4), e o saldo realizado reconstruído a partir dos lançamentos bate, centavo por centavo,
com o saldo corrente de cada conta.

## Scope / Non-goals

- **Em escopo:** o módulo `reporting`, somente leitura; a regra de composição de saldo; o saldo
  realizado de uma conta em qualquer data; o saldo previsto por conta e consolidado, mês a mês, com
  carry-forward e com a dívida dos cartões; os relatórios de despesas e de receitas por tipo e por
  mês; o fluxo de caixa realizado; autorização; o contrato no `openapi.yaml`.
- **Fora de escopo:** o resumo de uma fatura, que é da spec `0013`; orçamento e metas por
  categoria — citados na descrição do produto, mas sem requisito; alertas e notificações (saldo
  negativo, fatura vencida); exportação em PDF ou planilha; gráficos, que são do frontend;
  transferência entre contas próprias, que a spec `0018` modela e acrescenta a estes cálculos;
  cache ou tabela materializada — o volume real (centenas de lançamentos por ano) cabe em consulta
  direta, e uma tabela derivada seria um segundo lugar onde o saldo pode divergir.

## Contracts

### Módulo e fronteira

`reporting` é o único módulo que lê de vários contextos (ADR-0003, regra 5), e **só lê**:

- Lê `bank_accounts`, `credit_cards`, `expenses`, `expense_types`, `earnings`, `earning_types`,
  `credit_card_statements`, `credit_card_statement_payments` e `credit_card_refunds` por consulta
  própria, com o `DataSource` da plataforma, sem entidade nem repositório dos outros módulos.
- Para as faturas futuras de um cartão — que não são persistidas e dependem do encadeamento da
  spec 0013 —, chama a interface pública do `statements`: `StatementService.list(creditCardId,
range)`, que esta spec acrescenta à 0013 (ver _Interface que esta spec acrescenta_). O
  encadeamento dos ciclos não é reimplementado aqui.
- Não grava em tabela nenhuma e não publica evento. Nenhum outro módulo importa `reporting`.

### Regra de composição

Os conjuntos de status abaixo são a **única** definição de "realizado" e "pendente" do sistema.
Todo relatório desta spec os usa, e nenhum outro módulo os redefine.

| Conjunto         | Despesas (spec 0012)                       | Receitas (spec 0014)                       |
| ---------------- | ------------------------------------------ | ------------------------------------------ |
| **Realizado**    | `PAID`                                     | `RECEIVED`                                 |
| **Pendente**     | `OPEN`, `VERIFYING`, `OVERDUE`, `FORECAST` | `OPEN`, `VERIFYING`, `OVERDUE`, `FORECAST` |
| **Comprometido** | `OPEN`, `VERIFYING`, `OVERDUE`, `PAID`     | `OPEN`, `VERIFYING`, `OVERDUE`, `RECEIVED` |

- **Realizado** é dinheiro que se moveu: é o que o saldo corrente já contém.
- **Pendente** é o que ainda vai se mover e entra no saldo previsto. Inclui `FORECAST`, como o F002
  exige, e inclui `OVERDUE`: a despesa vencida e não paga continua sendo devida — a planilha define
  "em aberto" como "status diferente de Pago" (análise, 2).
- **Comprometido** é o que aconteceu ou certamente vai acontecer, sem o planejado: é a base dos
  relatórios por tipo, que por padrão excluem `FORECAST`.

### Saldo realizado de uma conta

O saldo corrente (spec 0011) só se move por três caminhos: receita recebida (spec 0014), despesa
de conta paga (spec 0012) e pagamento de fatura (spec 0013). Por isso o saldo em qualquer data `D`
é reconstruível:

```
realizado(conta, D) = opening_balance_cents
                    + Σ earnings.amount_cents         com status RECEIVED e received_on ≤ D
                    − Σ expenses.amount_cents         de conta, status PAID e paid_on ≤ D
                    − Σ statement_payments.amount_cents  da conta e paid_on ≤ D
```

**Consistência:** `realizado(conta, D)` para `D` a partir da maior data registrada nos três
caminhos é igual a `current_balance_cents`. Uma divergência é defeito — de implementação ou de
dado —, nunca arredondamento: o sistema não tem ponto flutuante (INV-0000-04).

### Saldo previsto

Para `D` igual ou posterior a hoje (`businessToday()`, spec 0012):

```
previsto(conta, D) = current_balance_cents
                   + Σ receitas pendentes da conta  com occurred_on ≤ D
                   − Σ despesas pendentes da conta  com occurred_on ≤ D
```

- Pendências com `occurred_on` no passado — vencidas, ou abertas com data já passada — entram no
  primeiro ponto futuro: ainda vão se mover.
- Despesa de **cartão** não entra diretamente no saldo de conta nenhuma: ela é paga pela fatura.
  Ela entra na **dívida dos cartões**, abaixo, que é descontada da conta pagadora do cartão.

**Dívida dos cartões** em `D`, por cartão, sobre as faturas de `StatementService.list`:

```
dívida(cartão, D) = Σ remainingCents             das faturas CLOSED
                  + Σ (totalCents − paidCents     das faturas projetadas (OPEN) com dueOn ≤ D
                       + previstasCents)
                  + crédito                       restante negativo da última fatura PAID, se houver
```

- `previstasCents` é a soma das despesas `FORECAST` do cartão com `postedOn` na janela da fatura,
  lida por consulta própria: o total da fatura as exclui (spec 0013), o previsto as inclui (F002).
- Nas projetadas usa-se `totalCents − paidCents`, **sem** `previousBalanceCents`: o restante da
  fechada já foi contado na primeira linha, e somá-lo de novo contaria a mesma dívida duas vezes.
- `ROLLED_OVER` não entra: o seu restante já está na fatura seguinte.

**Conta pagadora.** Para que o previsto de uma conta mostre o que vai sobrar depois das faturas, o
cartão ganha a conta pagadora padrão `paymentBankAccountId` (emenda à spec 0011). Cada ponto
previsto de uma conta traz `cardDebtCents`, a soma da dívida dos cartões que ela paga, e
`balanceAfterCardsCents = balanceCents − cardDebtCents`. A dívida de cartão sem conta pagadora não
é atribuída a conta nenhuma e aparece em `unassignedCardDebtCents`.

**Consolidado** em `D`: `Σ previsto(conta, D)` de todas as contas, arquivadas inclusive,
`− Σ dívida(cartão, D)` de todos os cartões, atribuídos ou não. É o "Saldo Final" da planilha: contas mais "a pagar"
mais "a receber" (análise, 2.1).

### Série mensal

`GET /reports/balance?from=YYYY-MM&to=YYYY-MM&bankAccountId?` devolve um ponto por mês, de `from`
a `to`, inclusivos, com `D` = último dia do mês — o carry-forward da planilha, em que cada mês
parte do saldo do anterior.

- Meses inteiramente passados têm `kind: 'REALIZED'`, com o saldo realizado das contas e sem
  dívida de cartão (`cardDebtCents: null`): a dívida passada de um cartão já é fatura paga ou
  rolada, e o que saiu da conta já está no realizado.
- O mês corrente e os seguintes têm `kind: 'FORECAST'`, com o saldo previsto, a dívida dos cartões
  e o detalhe do mês: `pendingEarningsCents` e `pendingExpensesCents` com `occurred_on` dentro do
  mês — no mês corrente, também as pendências com data passada — e `cardDueCents`, a dívida das
  faturas que vencem no mês.
- Com `bankAccountId`, só aquela conta, com a dívida dos cartões que ela paga, e sem consolidado;
  sem ele, todas as contas e o consolidado.
- A janela cobre no máximo 120 meses (`ERR-0015-02`), o maior parcelamento das specs 0012 e 0014.

### Relatórios por tipo

`GET /reports/expenses-by-type?from=YYYY-MM&to=YYYY-MM&includeForecast?` e
`GET /reports/earnings-by-type?…` agrupam por mês e por tipo a soma de `amount_cents` dos
lançamentos **comprometidos** — mais os `FORECAST`, com `includeForecast=true`.

- O mês de uma despesa é o de `occurred_on` — a data da compra, no cartão, ou do vencimento, na
  conta: "quanto gastei em Alimentação em março" é pergunta de competência, não de caixa. O de uma
  receita é o de `occurred_on`.
- Estornos de cartão (spec 0013) aparecem em `refundsCents` por mês, pelo `occurredOn` do estorno,
  e não são abatidos do tipo da despesa: o estorno não tem tipo, e a ligação com a despesa é
  informativa.
- Cada mês traz o total, e a soma dos tipos é igual a ele, sempre.

### Fluxo de caixa

`GET /reports/cash-flow?from=YYYY-MM&to=YYYY-MM&bankAccountId?` devolve, por mês e por conta, o
dinheiro que **de fato** se moveu — só o realizado:

- `inflowsCents`: receitas `RECEIVED` com `received_on` no mês.
- `expensesPaidCents`: despesas de conta `PAID` com `paid_on` no mês.
- `statementPaymentsCents`: pagamentos de fatura com `paid_on` no mês.
- `netCents = inflowsCents − expensesPaidCents − statementPaymentsCents`.

Somado mês a mês desde o primeiro movimento, o `netCents` de uma conta mais o
`opening_balance_cents` é o seu saldo realizado.

### Corpos

```
BalanceReport {
    from, to,
    points: [{
        month,                         // 'YYYY-MM'
        kind,                          // 'REALIZED' | 'FORECAST'
        accounts: [{ bankAccountId, balanceCents,
                     pendingEarningsCents?, pendingExpensesCents?,     // só em FORECAST
                     cardDebtCents?, balanceAfterCardsCents? }],       // só em FORECAST
        accountsTotalCents,
        cardDebtCents,                 // todos os cartões; null em REALIZED ou com bankAccountId
        unassignedCardDebtCents,       // cartões sem conta pagadora; idem
        cardDueCents,                  // idem
        consolidatedCents              // accountsTotalCents − cardDebtCents; null com bankAccountId
    }]
}
ByTypeReport {
    from, to, includeForecast,
    months: [{ month, totalCents, refundsCents?,   // refundsCents só em despesas
               byType: [{ typeId, name, totalCents }] }]   // por totalCents decrescente, depois name
}
CashFlowReport {
    from, to,
    months: [{ month,
               accounts: [{ bankAccountId, inflowsCents, expensesPaidCents,
                            statementPaymentsCents, netCents }],
               netCents }]
}
```

Dinheiro em inteiro de centavos com sufixo `Cents`; somas feitas em `numeric` no banco e
convertidas na fronteira, nunca em ponto flutuante (INV-0000-04).

### Endpoints

| Método | Rota                        | Perfil   |
| ------ | --------------------------- | -------- |
| `GET`  | `/reports/balance`          | qualquer |
| `GET`  | `/reports/expenses-by-type` | qualquer |
| `GET`  | `/reports/earnings-by-type` | qualquer |
| `GET`  | `/reports/cash-flow`        | qualquer |

Ler relatório é ler: qualquer perfil com acesso, como as listagens das specs 0011 a 0014.

### Interface que esta spec acrescenta

- **Ao `statements` (spec 0013):** `src/statements/index.ts` passa a exportar
  `StatementService.list(creditCardId: string, range: { from: Date; to: Date }): Promise<StatementResponse[]>`,
  o mesmo serviço de `GET /statements`, com o fechamento de recuperação que a 0013 já exige antes de
  responder. É leitura; o `reporting` não chama nada que pague, estorne ou desfaça.
- `src/reporting/index.ts` exporta só as classes de rota e controller.

## Invariants

- **INV-0015-01:** `reporting` não grava em tabela nenhuma e não publica evento; nenhum módulo
  importa `reporting` (ADR-0003, regra 5). Verificado pelo gate `boundaries`.
- **INV-0015-02:** os conjuntos realizado, pendente e comprometido são definidos uma vez, nesta
  spec, e todo relatório os usa (planilha legada, item 3.4).
- **INV-0015-03:** o saldo realizado de uma conta, a partir da sua última data de movimento, é
  igual a `current_balance_cents`.
- **INV-0015-04:** toda soma é feita em `numeric` e devolvida em inteiro de centavos; nenhum
  relatório usa ponto flutuante (INV-0000-04).
- **INV-0015-05:** `FORECAST` entra no saldo previsto e nunca no realizado, no fluxo de caixa nem,
  por padrão, nos relatórios por tipo.
- **INV-0015-06:** nenhuma dívida de cartão é contada duas vezes: o restante de uma fatura fechada
  entra uma vez, e o saldo anterior das projetadas não é somado.
- **INV-0015-07:** em todo relatório, a soma das partes é igual ao total de cada mês.

## Error cases

| Situação                                                                    | Comportamento exigido                     |
| --------------------------------------------------------------------------- | ----------------------------------------- |
| **ERR-0015-01** `from` ou `to` ausente, ou fora de `YYYY-MM`; `from` > `to` | `400`, `VALIDATION_ERROR` citando o campo |
| **ERR-0015-02** Janela com mais de 120 meses                                | `400`, `VALIDATION_ERROR`                 |
| **ERR-0015-03** `bankAccountId` inexistente                                 | `404`, `BANK_ACCOUNT_NOT_FOUND`           |
| **ERR-0015-04** `includeForecast` fora de `true`/`false`                    | `400`, `VALIDATION_ERROR`                 |

## Acceptance criteria

- **AC-0015-01:** uma conta aberta com 1000, com uma receita de 500 recebida em 10/03, uma despesa
  de 200 paga em 15/03 e um pagamento de fatura de 100 em 20/03, tem saldo realizado 1000 em 09/03,
  1500 em 10/03 e 1200 em 31/03, e o de 31/03 é igual a `currentBalanceCents` (INV-0015-03).
- **AC-0015-02:** com saldo corrente 1200 hoje, uma receita `OPEN` de 300 este mês, uma `FORECAST`
  de 400 no mês seguinte, uma despesa `OVERDUE` de 100 do mês passado e uma `OPEN` de 50 no mês
  seguinte, a série dá 1400 no mês corrente e 1750 no seguinte (INV-0015-05).
- **AC-0015-03:** uma despesa de cartão não altera o saldo previsto de conta nenhuma e entra na
  dívida do cartão no consolidado.
- **AC-0015-04:** um cartão com uma fatura `CLOSED` de restante 1100 e uma aberta com total 800,
  50 pagos antecipadamente e uma despesa `FORECAST` de 70, tem dívida 1100 antes do vencimento da
  aberta e 1920 a partir dele — sem somar de novo os 1100 que a aberta carrega em
  `previousBalanceCents` (INV-0015-06).
- **AC-0015-05:** uma fatura `ROLLED_OVER` não entra na dívida; o crédito de uma fatura `PAID` com
  restante −200 reduz a dívida em 200.
- **AC-0015-06:** `GET /reports/balance` de três meses atrás a dois à frente devolve três pontos
  `REALIZED`, com `cardDebtCents` nulo, e três `FORECAST`; com `bankAccountId`, só aquela conta e
  `consolidatedCents` nulo.
- **AC-0015-07:** `expenses-by-type` de março soma as despesas comprometidas por `occurredOn`,
  exclui `FORECAST` por padrão e inclui com `includeForecast=true`; um estorno de março aparece em
  `refundsCents` sem abater o tipo; a soma dos tipos é o total do mês (INV-0015-07).
- **AC-0015-08:** `earnings-by-type` agrupa as receitas comprometidas por tipo e mês, com a mesma
  regra de `FORECAST`.
- **AC-0015-09:** `cash-flow` de março mostra as receitas recebidas, as despesas pagas e os
  pagamentos de fatura com data em março, por conta; uma receita `OPEN` de março não aparece.
- **AC-0015-10:** `from > to`, mês malformado ou janela de 121 meses recebem `400`;
  `bankAccountId` inexistente recebe `404`.
- **AC-0015-11:** `VIEWER` lê os quatro relatórios; sem perfil, `403 PROFILE_PENDING`.
- **AC-0015-12:** com 1000 lançamentos de valores com centavos, todo total bate exatamente com a
  soma dos inteiros de centavos (INV-0015-04).
- **AC-0015-13:** um cartão com conta pagadora A e dívida 1920 em `D` reduz o
  `balanceAfterCardsCents` de A em 1920 e não altera o de outra conta; um cartão sem conta
  pagadora entra em `unassignedCardDebtCents` e no consolidado, e em conta nenhuma.

## Test mapping

| Item                                              | Teste                                                     |
| ------------------------------------------------- | --------------------------------------------------------- |
| AC-0015-01, INV-0015-03                           | `tests/integration/reporting/realized-balance.spec.ts`    |
| AC-0015-02, AC-0015-03, AC-0015-06, INV-0015-05   | `tests/integration/reporting/forecast-balance.spec.ts`    |
| AC-0015-04, AC-0015-05, AC-0015-13, INV-0015-06   | `tests/integration/reporting/card-debt.spec.ts`           |
| AC-0015-07, AC-0015-08, INV-0015-07               | `tests/integration/reporting/by-type.spec.ts`             |
| AC-0015-09                                        | `tests/integration/reporting/cash-flow.spec.ts`           |
| AC-0015-10, AC-0015-11, ERR-0015-01 a ERR-0015-04 | `tests/integration/reporting/validation-and-auth.spec.ts` |
| AC-0015-12, INV-0015-04                           | `tests/integration/reporting/precision.spec.ts`           |
| INV-0015-01, INV-0015-02                          | gate `boundaries` e revisão em PR                         |

## Open questions

Nenhuma.
