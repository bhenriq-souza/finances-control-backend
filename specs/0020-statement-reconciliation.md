---
id: '0020'
title: Conferência da fatura — despesas incluídas na fatura do banco
status: approved
depends_on: ['0000', '0003', '0012', '0013']
---

# 0020 — Conferência da fatura

## Goal

Permitir que o responsável confira a fatura aberta de um cartão contra a fatura do app do banco
sem fazer contas à mão. O banco demora a mostrar na fatura algumas despesas que o sistema já
conhece: a parcela que já consumiu o limite, a assinatura que ainda vai cair. A planilha antiga
resolvia isso com a coluna "Incluído". Ao final, toda despesa de cartão tem a marca **incluída**,
ligada e desligada pelo responsável conforme a despesa aparece no banco. A fatura mostra o total
**conferido** e o **pendente**. O conferido é o número que deve bater com o app do banco. Marcar
não muda o total da fatura, o limite nem o saldo, com uma exceção: a despesa prevista que acabou
de cair passa a aberta no mesmo passo e consome o limite, como na confirmação da spec `0012`.

## Scope / Non-goals

- **Em escopo:**
    - a coluna `reconciled_at` em `expenses`;
    - a rota `PATCH /expenses/:id/reconciliation`;
    - a confirmação de uma despesa `FORECAST` ao marcá-la;
    - o campo `reconciledAt` em `ExpenseResponse` e em `CardExpenseSummary`;
    - os valores `reconciledCents` e `pendingReconciliationCents` da fatura;
    - o contrato no `openapi.yaml` e a coleção do Postman (`npm run postman`).
- **Fora de escopo:**
    - importar ou ler a fatura do banco: a conferência é manual, linha a linha;
    - marcar várias despesas numa chamada só;
    - conferir estornos: o responsável lança o estorno quando o vê no banco, então todo estorno
      conta como conferido (INV-0020-04);
    - mudar o fechamento: fechar uma fatura não marca nem desmarca nada;
    - relatórios (spec `0015`) e a carga inicial (spec `0019`), que não leem a marca;
    - a tela, que é da FCF-023.

## Contracts

### Vocabulário

- **Incluída** é a despesa de cartão que o responsável já viu na fatura do banco. É a marca
  `reconciledAt`, não um status: as duas coisas variam de forma independente. Uma parcela pode
  estar `OPEN`, já ter consumido o limite (spec `0012`) e ainda não estar incluída.
- **Conferir** é ligar ou desligar a marca.

### Modelo

`expenses` ganha uma coluna, por migration nova:

| Coluna          | Tipo          | Regra                                    |
| --------------- | ------------- | ---------------------------------------- |
| `reconciled_at` | `timestamptz` | nullable; quando a despesa foi conferida |

- `ck_expenses_reconciled_at`: `reconciled_at` só pode ser não nulo em despesa de cartão
  (`credit_card_id` não nulo) que não esteja `FORECAST`. A despesa de conta não tem fatura, e a
  prevista ainda não aconteceu.
- As despesas existentes ficam com `reconciled_at` nulo.

### Rota

| Método  | Rota                           | Perfil            |
| ------- | ------------------------------ | ----------------- |
| `PATCH` | `/expenses/:id/reconciliation` | `ADMIN`, `BILLER` |

Corpo: `{ reconciled: boolean }`. Resposta: `200` com o `ExpenseResponse` da despesa.

| Situação da despesa de cartão | `reconciled: true`                                                                   | `reconciled: false`    |
| ----------------------------- | ------------------------------------------------------------------------------------ | ---------------------- |
| `OPEN`, `VERIFYING`, `PAID`   | `reconciled_at = now()`; se já estava marcada, fica como estava                      | `reconciled_at = null` |
| `FORECAST`                    | transição `FORECAST → OPEN` da spec `0012` e `reconciled_at = now()`, numa transação | `200` sem efeito       |

- A transição de uma `FORECAST` é a mesma de `PATCH /expenses/:id/status`. Ela consome o limite do
  cartão e é recusada na janela fechada (`ERR-0013-08`). Recusada, nada muda: nem o status, nem o
  limite, nem a marca.
- Desmarcar não desfaz a confirmação: a despesa continua `OPEN`.
- Marcar ou desmarcar não move saldo nem limite, não muda `occurredOn`, `postedOn`, `amountCents`
  nem o total de nenhuma fatura. Também não publica evento.
- A janela fechada (spec `0013`) aceita marcar e desmarcar despesas que não estejam `FORECAST`,
  porque isso não muda o total.

### Outros caminhos que mexem na marca

- **Troca de forma de pagamento** (`PATCH /expenses/:id/payment-method`, spec `0012`): uma despesa
  que sai de um cartão perde a marca, para outro cartão ou para uma conta. A marca dizia respeito à
  fatura de outro banco.
- `PATCH /expenses/:id` (valor, datas, descrição) preserva a marca. Quem corrige o valor para bater
  com o banco não precisa conferir de novo.
- O pagamento da fatura (`markPaidByStatement`), o desfazer do pagamento e a promoção diária de
  `FORECAST` para `OPEN` (spec `0017`) preservam a marca. A promoção nunca liga a marca.

### Corpos

- `ExpenseResponse` (spec `0012`) ganha `reconciledAt: string | null`, em ISO 8601. É sempre nulo
  em despesa de conta.
- `CardExpenseSummary` (spec `0013`) ganha `reconciledAt: string | null`.
- `StatementResponse` (spec `0013`) ganha dois valores, na listagem e no detalhe, para toda fatura,
  fechada ou projetada:

| Campo                        | Definição                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `reconciledCents`            | soma das despesas da janela em `OPEN`, `VERIFYING` ou `PAID` **com** a marca, menos `refundsCents` |
| `pendingReconciliationCents` | soma das despesas da janela em `OPEN`, `VERIFYING` ou `PAID` **sem** a marca                       |

- `reconciledCents` é o número que se compara com a fatura do app do banco. Pode ser negativo,
  como o `totalCents`.
- `FORECAST` fica de fora dos dois valores, como já fica de `purchasesCents`.

### Interface pública

`src/expenses/index.ts` não ganha método. `listByCreditCard` passa a devolver `reconciledAt` em
cada `CardExpenseSummary`, e o `statements` calcula os dois valores a partir dele.

### Quem pode o quê

Conferir é gerenciar a fatura, então segue a tabela da spec `0013`:

| Operação                         | `ADMIN` | `BILLER` | `VIEWER` |
| -------------------------------- | ------- | -------- | -------- |
| Marcar e desmarcar como incluída | sim     | sim      | não      |

## Invariants

- **INV-0020-01:** `reconciled_at` é nulo em toda despesa de conta e em toda despesa `FORECAST`.
  O banco garante isso pela constraint `ck_expenses_reconciled_at`.
- **INV-0020-02:** marcar ou desmarcar nunca move saldo nem limite e nunca muda o total de uma
  fatura. A única exceção é a confirmação `FORECAST → OPEN` da spec `0012`, que acontece na mesma
  transação que a marca (ADR-0003, regra 4).
- **INV-0020-03:** em toda fatura, `reconciledCents + pendingReconciliationCents = totalCents`.
- **INV-0020-04:** estornos não têm marca e entram sempre no conferido.
- **INV-0020-05:** dinheiro em inteiro de centavos, sem ponto flutuante (INV-0000-04).

## Error cases

| Situação                                                               | Comportamento exigido                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------- |
| **ERR-0020-01** Conferir despesa de conta                              | `409`, `EXPENSE_NOT_ON_CREDIT_CARD`                     |
| **ERR-0020-02** Corpo sem `reconciled` ou com valor que não é booleano | `400`, `VALIDATION_ERROR` citando o campo               |
| **ERR-0020-03** `:id` inexistente                                      | `404`, `EXPENSE_NOT_FOUND` (o mesmo da ERR-0012-02)     |
| **ERR-0020-04** Marcar uma `FORECAST` da janela fechada                | `409`, `STATEMENT_CLOSED` (ERR-0013-08), sem mudar nada |
| **ERR-0020-05** `VIEWER` tenta conferir                                | `403`, `FORBIDDEN`                                      |

## Acceptance criteria

- **AC-0020-01:** marcar uma despesa `OPEN` de cartão responde `200` com `reconciledAt`
  preenchido. O status, o limite disponível do cartão e o `totalCents` da fatura não mudam.
- **AC-0020-02:** marcar de novo uma despesa já marcada mantém o `reconciledAt` original.
  Desmarcar deixa `reconciledAt` nulo, e desmarcar de novo responde `200` sem efeito.
- **AC-0020-03:** marcar uma despesa `FORECAST` de cartão de R$ 14,90 a deixa `OPEN` e incluída,
  e reduz o limite disponível em 1490 centavos, numa transação. Desmarcá-la em seguida a mantém
  `OPEN`.
- **AC-0020-04:** marcar uma `FORECAST` cuja `postedOn` está na janela fechada recebe `409
STATEMENT_CLOSED`. A despesa continua `FORECAST`, sem marca, e o limite não muda.
- **AC-0020-05:** conferir despesa de conta recebe `409 EXPENSE_NOT_ON_CREDIT_CARD`. Um `:id`
  inexistente recebe `404 EXPENSE_NOT_FOUND`, e um corpo inválido recebe `400 VALIDATION_ERROR`.
- **AC-0020-06:** um `VIEWER` recebe `403`. `ADMIN` e `BILLER` conferem.
- **AC-0020-07:** um `UPDATE` direto no banco que ponha `reconciled_at` numa despesa de conta ou
  numa `FORECAST` falha pela constraint `ck_expenses_reconciled_at`.
- **AC-0020-08:** uma despesa marcada que troca de cartão, ou passa do cartão para uma conta,
  chega ao destino sem a marca. Um `PATCH /expenses/:id` que muda o valor preserva a marca.
- **AC-0020-09:** numa fatura aberta com compras de 100,00 (incluída), 50,00 (não incluída),
  30,00 (`FORECAST`) e um estorno de 20,00, `GET /statements/current` devolve
  `totalCents = 13000`, `reconciledCents = 8000` e `pendingReconciliationCents = 5000`. Cada
  despesa traz o seu `reconciledAt`.
- **AC-0020-10:** `GET /statements` (listagem) e `GET /statements/:id` (fechada) também trazem os
  dois valores, e INV-0020-03 vale em todas as faturas devolvidas.
- **AC-0020-11:** o `openapi.yaml` declara a rota, o corpo, os erros e os campos novos.

## Test mapping

| Item                                                                       | Teste                                                                               |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| AC-0020-01, AC-0020-02, AC-0020-03, INV-0020-02                            | `tests/integration/expenses/reconciliation.spec.ts`                                 |
| AC-0020-04, ERR-0020-04                                                    | `tests/integration/expenses/reconciliation.spec.ts`                                 |
| AC-0020-05, AC-0020-06, ERR-0020-01, ERR-0020-02, ERR-0020-03, ERR-0020-05 | `tests/integration/expenses/reconciliation.spec.ts`                                 |
| AC-0020-07, INV-0020-01                                                    | `tests/integration/expenses/reconciliation.spec.ts` (SQL direto)                    |
| AC-0020-08                                                                 | `tests/integration/expenses/reconciliation.spec.ts`                                 |
| AC-0020-09, AC-0020-10, INV-0020-03, INV-0020-04                           | `tests/integration/statements/reconciliation.spec.ts`                               |
| INV-0020-05                                                                | os mesmos testes, com valores em centavos inteiros                                  |
| AC-0020-11                                                                 | `tests/openapi.spec.ts` (rotas publicadas), `tests/postman.spec.ts` e revisão em PR |

## Open questions

Nenhuma.
