---
id: '0018'
title: Transfers — transferências entre contas próprias
status: implemented
depends_on: ['0000', '0003', '0004', '0010', '0011', '0012', '0015']
---

# 0018 — Transfers

## Goal

Registrar o dinheiro que muda de conta sem sair do patrimônio: da conta corrente para a poupança, o
resgate de um investimento, o envio de um banco para outro. Ao final, uma transferência move o
saldo das duas contas na **mesma transação**, nunca aparece como despesa nem como receita — e por
isso não distorce os relatórios por tipo —, e entra no saldo realizado, no saldo previsto e no
fluxo de caixa de cada conta, sem mudar o consolidado, porque o que sai de uma entra na outra.

## Scope / Non-goals

- **Em escopo:** a transferência entre duas contas bancárias do sistema, realizada ou agendada; o
  reflexo no saldo das duas contas na mesma transação; concluir, desfazer, alterar e excluir; o
  evento `TransferCompleted`; autorização por perfil; a emenda aos cálculos da spec `0015`; o
  contrato no `openapi.yaml`.
- **Fora de escopo:** transferência para conta de terceiros — isso é despesa (spec 0012), e o
  dinheiro emprestado que volta é receita (spec 0014); pagamento de fatura, que já é da spec
  `0013`; tarifa de transferência, lançada como despesa à parte; transferência recorrente — a
  aplicação mensal na poupança —, que pode ganhar série como a spec `0017` depois, se o uso pedir;
  rendimento de investimento, que é receita (spec 0014, tipo `Rendimento de investimento`);
  conversão de moeda (BRL implícito, ADR-0007).

## Contracts

### Módulo

A transferência vive no `accounts`: o módulo dono do saldo é o único que o move sem passar por
interface de outro (spec 0011, _Quem move saldo e limite_). A transferência é o terceiro caminho
pelo qual o saldo corrente se move, ao lado de despesa paga e receita recebida — e o único interno
ao módulo. Não há módulo novo (ADR-0003).

### Modelo

#### `bank_transfers`

| Coluna                    | Tipo            | Regra                                                                                      |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------------ |
| `id`                      | `uuid`          | PK, `gen_random_uuid()`                                                                    |
| `from_bank_account_id`    | `uuid`          | not null, FK `bank_accounts(id)` `on delete restrict`                                      |
| `to_bank_account_id`      | `uuid`          | not null, FK `bank_accounts(id)` `on delete restrict`                                      |
| `amount_cents`            | `numeric(14,2)` | not null, `ck_bank_transfers_amount` > 0                                                   |
| `occurred_on`             | `date`          | not null — a data prevista, ou a data em que aconteceu                                     |
| `status`                  | `text`          | not null, `ck_bank_transfers_status`: `SCHEDULED`/`COMPLETED`                              |
| `completed_on`            | `date`          | nullable, `ck_bank_transfers_completed_on`: not null **se e só se** `status = 'COMPLETED'` |
| `description`             | `text`          | not null                                                                                   |
| `notes`                   | `text`          | nullable                                                                                   |
| `created_at`/`updated_at` | `timestamptz`   | convenções da spec 0003                                                                    |

- `ck_bank_transfers_accounts`: `from_bank_account_id <> to_bank_account_id`.
- Índices: `idx_bank_transfers_from_bank_account_id`, `idx_bank_transfers_to_bank_account_id`,
  `idx_bank_transfers_occurred_on`.

### Status

- **`COMPLETED` (Concluída)** é a transferência que aconteceu: o dinheiro já saiu de uma conta e
  entrou na outra. É o caso comum — a transferência feita agora no app do banco —, e o default.
- **`SCHEDULED` (Agendada)** é a que vai acontecer: a aplicação agendada, o resgate programado. Não
  move saldo; entra no saldo previsto das duas contas (spec 0015).

Uma transferência só tem dois estados porque ela não é cobrança: não vence, não se confere, não se
prevê sem data. `SCHEDULED` com data passada continua agendada até alguém concluí-la ou excluí-la.

| Operação                           | Conta de origem                  | Conta de destino                 |
| ---------------------------------- | -------------------------------- | -------------------------------- |
| Criar `COMPLETED`                  | `current_balance −= amountCents` | `current_balance += amountCents` |
| Criar `SCHEDULED`                  | nada                             | nada                             |
| `SCHEDULED → COMPLETED` (concluir) | `current_balance −= amountCents` | `current_balance += amountCents` |
| `COMPLETED → SCHEDULED` (desfazer) | `current_balance += amountCents` | `current_balance −= amountCents` |
| Alterar ou excluir `SCHEDULED`     | nada                             | nada                             |

- **Mesma transação, ordem fixa de lock.** Os dois movimentos acontecem numa transação só
  (`TransactionRunner.run`, spec 0004), e as duas linhas de `bank_accounts` são travadas
  (`SELECT … FOR UPDATE`) **em ordem crescente de `id`** — duas transferências opostas e
  simultâneas entre as mesmas contas nunca se travam mutuamente. Os movimentos usam o mesmo
  mecanismo de `applyBalanceDelta` (spec 0012).
- **Saldo negativo é aceito**, como em despesas (INV-0012-09): o cheque especial existe, e o
  registro diz o que aconteceu.
- **Conta arquivada:** criar ou alterar uma transferência com conta arquivada em qualquer ponta é
  recusado (`ERR-0018-04`); concluir ou desfazer uma já existente é aceito, como pagar despesa
  antiga numa conta encerrada (spec 0012).
- `completedOn` é opcional ao concluir, default hoje (`businessToday()`, spec 0012).

### Endpoints

| Método   | Rota                         | Perfil            |
| -------- | ---------------------------- | ----------------- |
| `POST`   | `/bank-transfers`            | `ADMIN`, `BILLER` |
| `GET`    | `/bank-transfers`            | qualquer          |
| `GET`    | `/bank-transfers/:id`        | qualquer          |
| `PATCH`  | `/bank-transfers/:id`        | `ADMIN`, `BILLER` |
| `PATCH`  | `/bank-transfers/:id/status` | `ADMIN`, `BILLER` |
| `DELETE` | `/bank-transfers/:id`        | `ADMIN`, `BILLER` |

Transferir é movimentar, não cadastrar conta: o perfil é o de quem lança despesas e receitas
(specs 0012 e 0014), e não o `ADMIN` só, que a spec 0011 exige para gerenciar contas.

- **`POST`** com
  `{ fromBankAccountId, toBankAccountId, amountCents, occurredOn, status?, completedOn?, description, notes? }`;
  `status` default `COMPLETED`, e então `completedOn` default `occurredOn`.
- **`PATCH /:id`** aceita `description` e `notes` sempre; `fromBankAccountId`, `toBankAccountId`,
  `amountCents` e `occurredOn` só em `SCHEDULED` — na concluída, o saldo já se moveu, e quem quer
  corrigir desfaz antes (`ERR-0018-06`). `status` e `completedOn` vão por `…/status`.
- **`PATCH /:id/status`** com `{ status, completedOn? }`: `SCHEDULED → COMPLETED` conclui,
  `COMPLETED → SCHEDULED` desfaz; repetir o status atual é `409` (`ERR-0018-07`).
- **`DELETE`** só em `SCHEDULED` (`ERR-0018-06`): desfaça antes, para que os saldos voltem
  explicitamente.
- **`GET /bank-transfers`** aceita `bankAccountId` (origem **ou** destino), `status`, `from` e `to`
  (`occurredOn`, inclusivos), em ordem de `occurredOn` e depois `createdAt`.

### Corpos

```
BankTransferResponse { id, fromBankAccountId, toBankAccountId, amountCents, occurredOn,
                       status, completedOn, description, notes, createdAt, updatedAt }
```

Contas por id, dinheiro em inteiro de centavos com sufixo `Cents`, datas em `YYYY-MM-DD`.

### Evento

Em `src/events/accounts.events.ts` (spec 0004):

```ts
export const TRANSFER_COMPLETED = 'TransferCompleted' as const;
export type TransferCompleted = DomainEvent<
    typeof TRANSFER_COMPLETED,
    {
        transferId: string;
        fromBankAccountId: string;
        toBankAccountId: string;
        amountCents: number;
        completedOn: string;
    }
>;
```

Publicado ao criar concluída e ao concluir; desfazer não publica, como nas specs 0012 a 0014.
Nenhum módulo o consome nesta spec.

### Emenda à spec 0015

A transferência é um caminho a mais do saldo, e a regra única de composição da 0015 passa a
enxergá-la — o texto daquela spec é atualizado neste mesmo PR:

- **Saldo realizado:** `+ Σ` transferências `COMPLETED` com destino na conta e `completed_on ≤ D`,
  `− Σ` as com origem na conta. A consistência com `current_balance_cents` (INV-0015-03) continua
  valendo, agora com quatro caminhos.
- **Saldo previsto:** `+ Σ` transferências `SCHEDULED` com destino na conta e `occurred_on ≤ D`,
  `− Σ` as com origem nela. As agendadas com data passada entram no primeiro ponto futuro, como as
  demais pendências.
- **Consolidado:** não muda — o que sai de uma conta entra na outra, e a soma das contas é a mesma.
- **Fluxo de caixa:** cada conta ganha `transfersInCents` e `transfersOutCents`, pelo
  `completed_on`, e `netCents` os inclui; o `netCents` do mês somado sobre todas as contas não muda.
- **Relatórios por tipo:** não mudam. Transferência não tem tipo e não é gasto nem ganho — é o que
  esta spec existe para garantir.

### Interface pública do módulo

`src/accounts/index.ts` passa a exportar `BankTransferRoutes` e `BankTransferController`. O
`reporting` lê `bank_transfers` por consulta própria (ADR-0003, regra 5).

## Invariants

- **INV-0018-01:** todo valor é `numeric(14,2)` no banco e inteiro de centavos na aplicação e na
  API; `amount_cents` é sempre positivo (INV-0000-04).
- **INV-0018-02:** uma transferência liga duas contas **diferentes** do sistema.
- **INV-0018-03:** só transferência `COMPLETED` está nos saldos correntes, e a passagem para e de
  `COMPLETED` move as duas contas, em sentidos opostos e pelo mesmo valor, na **mesma transação**
  (ADR-0003, regra 4).
- **INV-0018-04:** as duas linhas de conta são travadas sempre em ordem crescente de `id`.
- **INV-0018-05:** `completed_on` é não nulo se e só se `status = 'COMPLETED'`.
- **INV-0018-06:** transferência concluída não se altera em contas, valor ou data, nem se exclui,
  sem antes desfazer.
- **INV-0018-07:** transferência nunca entra em relatório por tipo, e não altera o consolidado nem o
  fluxo de caixa somado de todas as contas.
- **INV-0018-08:** escrita exige `ADMIN` ou `BILLER`; leitura, qualquer perfil (spec 0010).

## Error cases

| Situação                                                                           | Comportamento exigido                              |
| ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| **ERR-0018-01** Origem igual ao destino                                            | `400`, `VALIDATION_ERROR` citando os dois campos   |
| **ERR-0018-02** `:id` inexistente                                                  | `404`, `BANK_TRANSFER_NOT_FOUND`                   |
| **ERR-0018-03** Conta inexistente                                                  | `404`, `BANK_ACCOUNT_NOT_FOUND`                    |
| **ERR-0018-04** Conta arquivada na criação ou na alteração                         | `409`, `BANK_ACCOUNT_ARCHIVED`                     |
| **ERR-0018-05** `amountCents` ≤ 0 ou não inteiro; `completedOn` com `SCHEDULED`    | `400`, `VALIDATION_ERROR` citando o campo          |
| **ERR-0018-06** Alterar contas, valor ou data, ou excluir, transferência concluída | `409`, `BANK_TRANSFER_ALREADY_COMPLETED`           |
| **ERR-0018-07** `…/status` para o status atual                                     | `409`, `BANK_TRANSFER_STATUS_UNCHANGED`            |
| **ERR-0018-08** `PATCH /:id` com `status` ou `completedOn`                         | `400`, `VALIDATION_ERROR` citando o campo recusado |
| **ERR-0018-09** `from` > `to` na listagem                                          | `400`, `VALIDATION_ERROR`                          |

## Acceptance criteria

- **AC-0018-01:** a migration cria `bank_transfers` com as constraints nomeadas; aplica e reverte num
  banco limpo; uma linha com origem igual ao destino é recusada pelo banco (INV-0018-02).
- **AC-0018-02:** transferir 300 concluída da conta A (saldo 1000) para B (saldo 50) deixa A em 700
  e B em 350 e publica `TransferCompleted` depois do commit (INV-0018-03).
- **AC-0018-03:** se o movimento da segunda conta falhar, nenhum saldo mudou e nenhum evento foi
  publicado (INV-0018-03).
- **AC-0018-04:** duas transferências simultâneas, A→B e B→A, terminam sem deadlock e com os dois
  saldos corretos (INV-0018-04).
- **AC-0018-05:** criar agendada não move saldo; concluir move as duas contas e grava `completedOn`
  (default hoje); desfazer devolve os dois saldos e zera `completedOn` (INV-0018-05).
- **AC-0018-06:** alterar valor ou excluir uma concluída recebe `409 BANK_TRANSFER_ALREADY_COMPLETED`;
  alterar `description` é aceito; alterar valor de uma agendada é aceito (INV-0018-06).
- **AC-0018-07:** transferir a partir de conta arquivada recebe `409 BANK_ACCOUNT_ARCHIVED`;
  transferir com saldo insuficiente é aceito e a origem fica negativa.
- **AC-0018-08:** com uma transferência concluída de 300 de A para B em 10/03, o saldo realizado de A
  em 31/03 é 300 menor e o de B 300 maior, e cada um continua igual ao `currentBalanceCents`
  (INV-0015-03).
- **AC-0018-09:** uma agendada de 200 de A para B no mês seguinte reduz o previsto de A e aumenta o
  de B naquele mês, e o consolidado não muda (INV-0018-07).
- **AC-0018-10:** o fluxo de caixa de março mostra 300 em `transfersOutCents` de A e em
  `transfersInCents` de B; os relatórios por tipo não mostram a transferência (INV-0018-07).
- **AC-0018-11:** `GET /bank-transfers?bankAccountId=A` lista as transferências que saem e as que
  entram em A; `from > to` é `400`.
- **AC-0018-12:** `VIEWER` lista e consulta e recebe `403 FORBIDDEN` em toda escrita; `BILLER`
  transfere; sem perfil, `403 PROFILE_PENDING` (INV-0018-08).

## Test mapping

| Item                                                                       | Teste                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| AC-0018-01, INV-0018-01, INV-0018-02, INV-0018-05                          | `tests/integration/platform/database/migrations.spec.ts` (extensão) |
| AC-0018-02 a AC-0018-05, INV-0018-03, INV-0018-04                          | `tests/integration/accounts/transfers-balance.spec.ts`              |
| AC-0018-06, AC-0018-07, AC-0018-11, INV-0018-06, ERR-0018-01 a ERR-0018-09 | `tests/integration/accounts/transfers.spec.ts`                      |
| AC-0018-08 a AC-0018-10, INV-0018-07                                       | `tests/integration/reporting/transfers.spec.ts`                     |
| AC-0018-12, INV-0018-08                                                    | `tests/integration/accounts/transfers-authorization.spec.ts`        |

## Open questions

Nenhuma.
