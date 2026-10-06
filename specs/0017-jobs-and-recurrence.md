---
id: '0017'
title: Jobs e recorrência — pg-boss, rotinas diárias e lançamentos fixos mensais
status: approved
depends_on: ['0000', '0003', '0004', '0012', '0013', '0014']
---

# 0017 — Jobs e recorrência

## Goal

Dar ao sistema o que acontece por passagem do tempo, sem ninguém pedir: a despesa que vence, a
fatura que fecha, o salário do mês que vem que já aparece como previsto. Ao final, o `pg-boss` roda
dentro do PostgreSQL existente, sem infraestrutura nova
([ADR-0005](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0005-queue.md),
regra 3); as rotinas diárias das specs 0012, 0013 e 0014 são agendadas no código, versionadas e
testáveis; e despesas e receitas fixas viram **séries** mensais, cujos meses futuros nascem como
`FORECAST` — o produtor que faltou à planilha legada (item 3.3) — e cujo cancelamento exclui os
meses futuros, nunca os pagos.

## Scope / Non-goals

- **Em escopo:** a porta de jobs em `src/platform/jobs/` e o adaptador `pg-boss`; o registro de
  jobs pela composição; retentativa, idempotência e log estruturado de falha; o estado dos jobs no
  readiness; o catálogo das rotinas diárias; a série de recorrência de despesas e receitas fixas,
  com geração, promoção a `OPEN`, alteração para os meses seguintes e encerramento; o schema
  `pgboss` no banco do cluster.
- **Fora de escopo:** o job de importação de CSV, cujo contrato é da spec `0016` — esta spec
  entrega a porta que ela usa; outbox e entrega diferida de eventos de domínio (ADR-0005, regra 4),
  que continuam in-process (spec 0004); recorrência com periodicidade diferente de mensal (semanal,
  anual); recorrência de parcelamento, que já é a parcela; painel de jobs; `CronJob` do
  Kubernetes, que o ADR-0005 rejeitou.

## Contracts

### A porta de jobs

`src/platform/jobs/job-queue.ts`, reexportado por `src/platform/index.ts`:

```ts
type JobHandler<TPayload extends JsonObject = JsonObject> = (job: {
    id: string;
    name: string;
    payload: TPayload;
    attempt: number;
}) => Promise<void>;

interface JobQueue {
    register<TPayload extends JsonObject>(name: string, handler: JobHandler<TPayload>): void;
    schedule(name: string, cron: string): void; // no fuso BUSINESS_TIME_ZONE
    enqueue<TPayload extends JsonObject>(
        name: string,
        payload: TPayload,
        options?: { singletonKey?: string },
    ): Promise<string>;
}
```

- A implementação é `PgBossJobQueue`, em `src/platform/jobs/pg-boss-job-queue.ts`, singleton no
  container sob `JobQueueSymbol`. Módulos dependem da porta e do símbolo, nunca de `pg-boss`: o
  pacote só é importável de `src/platform/jobs/`, regra nova no `.dependency-cruiser.cjs` — o mesmo
  isolamento do `firebase-admin` (spec 0010).
- `name` segue `<módulo>.<ação-em-kebab-case>` (`expenses.mark-overdue`). `payload` é JSON, como o
  envelope de evento (spec 0004): só identificadores e escalares.
- `schedule` usa a expressão cron no fuso de negócio `America/Sao_Paulo` (`BUSINESS_TIME_ZONE`,
  spec 0012). Agendar duas vezes o mesmo nome substitui o agendamento — idempotente no boot.
- `enqueue` com `singletonKey` não enfileira um segundo job com a mesma chave enquanto o primeiro
  não terminou.

### Execução, retentativa e falha

- **Mesmo processo.** O worker roda dentro da aplicação, iniciado no boot depois do `DataSource`.
  Com mais de uma réplica, o `pg-boss` garante que cada job e cada disparo agendado é entregue a
  uma réplica só.
- **Retentativa:** 3 tentativas além da primeira, com espera exponencial a partir de 60 s; job que
  não termina em 15 minutos expira e conta como falha.
- **Idempotência é do handler.** Todo handler desta spec pode rodar duas vezes, ou depois de dias
  sem rodar, e chegar ao mesmo estado: todos derivam do que fazer a partir de datas e do estado
  atual, nunca de "o que mudou desde a última execução".
- **Contexto:** o handler roda com `correlationId` igual ao `id` do job, no `RequestContext` da
  plataforma — os eventos que ele publicar e os logs que ele escrever ficam ligados ao job.
- **Log estruturado:** início e fim em nível `info` com `job`, `jobId`, `attempt` e `durationMs`;
  falha em nível `error` com os mesmos campos e `error`; a última tentativa falhada também em
  `error`, com `exhausted: true`. É a observabilidade de falha que o FCB-015 pede, sem painel.
- **Configuração:** `JOBS_ENABLED` (`env.list`, default `true`). Com `false`, nada é registrado nem
  iniciado — é o modo dos testes que não exercitam jobs e o interruptor de emergência.

### Readiness

`GET /health/ready` (spec 0003) ganha `checks.jobs`: `up` com o `pg-boss` iniciado, `down` se ele
falhou ao iniciar ou parou, `disabled` com `JOBS_ENABLED=false`. Só `down` torna a aplicação não
pronta (`503 NOT_READY`): sem worker, nada vence nem fecha, e é melhor o cluster saber.

### Registro pela composição

`platform` não conhece os módulos. Como os subscribers da spec 0004, um módulo exporta na sua
interface pública uma classe que implementa:

```ts
interface JobRegistrar {
    register(queue: JobQueue): void;
}
```

`ApiModule` ganha o campo opcional `jobs: JobRegistrar[]`, tratado por `registerApiModules` quando
`JOBS_ENABLED`, antes de o worker começar a consumir.

### Rotinas diárias

Todas agendadas para `15 0 * * *` (00h15 em `America/Sao_Paulo`), cada uma com `asOf` igual a
`businessToday()` no momento da execução:

| Job                            | Módulo       | Chama                                    | Spec |
| ------------------------------ | ------------ | ---------------------------------------- | ---- |
| `statements.close-due`         | `statements` | `StatementService.closeDue(asOf)`        | 0013 |
| `expenses.extend-recurrences`  | `expenses`   | `ExpenseRecurrenceService.extend(asOf)`  | esta |
| `expenses.promote-recurrences` | `expenses`   | `ExpenseRecurrenceService.promote(asOf)` | esta |
| `expenses.mark-overdue`        | `expenses`   | `ExpenseService.markOverdue(asOf)`       | 0012 |
| `earnings.extend-recurrences`  | `earnings`   | `EarningRecurrenceService.extend(asOf)`  | esta |
| `earnings.promote-recurrences` | `earnings`   | `EarningRecurrenceService.promote(asOf)` | esta |
| `earnings.mark-overdue`        | `earnings`   | `EarningService.markOverdue(asOf)`       | 0014 |

- A ordem entre eles não é garantida e não importa: cada um é idempotente e deriva de datas. Uma
  ocorrência promovida hoje tem `occurredOn <= hoje`, e a varredura só marca vencida a de
  `occurredOn < asOf` — ela vence no dia seguinte, se não for paga.
- **Recuperação:** depois de dias sem rodar, a primeira execução faz o trabalho de todos eles. O
  fechamento de fatura já não depende de job (spec 0013, INV-0013-08); os demais passam a não
  depender da pontualidade dele.

### Recorrência: a série

Hoje um lançamento `FIXED` é uma linha só (specs 0012 e 0014), e nada cria o mês seguinte. Esta
spec dá a ele uma **série**, nos dois módulos, com as mesmas regras — o que se diz de despesa abaixo
vale para receita, trocando `paid` por `received` e cartão por nada, já que receita só tem conta.

#### `expense_recurrences` e `earning_recurrences`

Uma tabela em cada módulo, pelas convenções da spec 0003:

| Coluna                    | Tipo            | Regra                                                                |
| ------------------------- | --------------- | -------------------------------------------------------------------- |
| `id`                      | `uuid`          | PK                                                                   |
| `description`             | `text`          | not null — o modelo dos meses seguintes                              |
| `expense_type_id`         | `uuid`          | not null, FK (`earning_type_id` em receitas)                         |
| `amount_cents`            | `numeric(14,2)` | not null, > 0                                                        |
| `day_of_month`            | `integer`       | not null, 1 a 31 — o dia da primeira ocorrência                      |
| `bank_account_id`         | `uuid`          | nullable, FK                                                         |
| `credit_card_id`          | `uuid`          | nullable, FK — só em despesas; exatamente um dos dois (`ck_*_owner`) |
| `notes`                   | `text`          | nullable                                                             |
| `starts_on`               | `date`          | not null — a data da primeira ocorrência                             |
| `ends_on`                 | `date`          | nullable — última data admitida; nula é série sem fim                |
| `created_at`/`updated_at` | `timestamptz`   | convenções da spec 0003                                              |

`expenses` e `earnings` ganham `recurrence_id uuid` nullable, FK para a tabela do mesmo módulo, com
`ck_*_recurrence`: `recurrence_id` não nulo **se e só se** `kind = 'FIXED'`; e
`uq_*_recurrence_id_occurred_on` sobre `(recurrence_id, occurred_on)` — o que torna a geração
idempotente por construção.

#### Criação

`POST /expenses` com `kind: 'FIXED'` (spec 0012) passa a criar, na mesma transação:

1. a série, com o modelo tirado do corpo, `day_of_month` e `starts_on` de `occurredOn`, e `ends_on`
   do campo opcional novo `recurrenceEndsOn`;
2. a primeira ocorrência, com o `status` informado — é a de hoje, e o usuário sabe se está aberta;
3. as ocorrências dos meses seguintes até o **horizonte**, como `FORECAST`.

A resposta é a lista de todas as ocorrências criadas, o formato único das specs 0012 e 0014, e
`ExpenseCreated` sai uma vez por linha.

**Horizonte:** o último dia do 12º mês depois do mês de hoje. Uma série criada em março tem
ocorrências até o fim de março do ano seguinte — o bastante para o saldo previsto do ano (spec
0015), sem gerar linhas de uma década.

**Datas:** a ocorrência do mês `m` é no `day_of_month`, resolvido para o último dia do mês quando
não existe — a regra das parcelas (spec 0012). Despesa de cartão recebe o `postedOn` default da
spec 0013.

#### Extensão

`ExpenseRecurrenceService.extend(asOf)` cria, para toda série sem `ends_on` ou com `ends_on`
futuro, as ocorrências que faltam até o horizonte de `asOf`, como `FORECAST`, copiando o modelo
atual da série. É idempotente pela constraint única: um mês que já tem ocorrência — gerada,
alterada ou paga — nunca recebe outra. Devolve quantas criou. Cada série é estendida numa
transação própria, com `ExpenseCreated` por linha.

#### Promoção

`ExpenseRecurrenceService.promote(asOf)` passa a `OPEN` toda ocorrência **de série** em `FORECAST`
com `occurredOn <= asOf`: o planejado do mês chegou e virou compromisso — "nascem como Previsto e
são promovidas a Aberto no vencimento" (análise, 3.3). A transição é a `FORECAST → OPEN` da spec
0012, com os mesmos efeitos: a de cartão consome limite na mesma transação. `FORECAST` lançado à mão,
sem série, não é promovido: quem o planejou é quem o confirma. A promoção é no **dia da
ocorrência**, e não no primeiro dia do mês: até lá ela é "Previsto", e a assinatura no cartão
consome limite no dia em que é cobrada, como no cartão real.

#### Alteração

`PATCH /expenses/:id` numa ocorrência de série altera só ela, como hoje. Com `?scope=following`,
os campos `description`, `expenseTypeId`, `amountCents` e `notes` valem também para o **modelo**
da série e para as ocorrências **seguintes** ainda em `FORECAST` — o reajuste do aluguel a partir
de março. As anteriores, as já promovidas e as pagas não mudam: o que já aconteceu fica como foi.
Trocar a conta ou o cartão de uma série (spec 0012, troca de forma de pagamento) segue a mesma
regra com `?scope=following`.

#### Encerramento

`DELETE /expenses/:id` numa ocorrência de série — a regra já fixada para recorrências: **exclui os
futuros, nunca os pagos**:

- exclui a ocorrência e todas as **seguintes** não pagas, na mesma transação, com os efeitos de
  limite da spec 0012 para cada uma;
- as seguintes já pagas permanecem, e as anteriores, pagas ou não, também — uma conta de luz
  vencida e não paga continua devida;
- as de cartão em janela fechada permanecem (spec 0013);
- a série recebe `ends_on` igual ao dia anterior à ocorrência excluída, e a extensão para de
  gerar.

Encerrar sem excluir — "este é o último mês" — é `PATCH /expense-recurrences/:id` com `{ endsOn }`,
que também exclui as ocorrências `FORECAST` posteriores a `endsOn`.

#### Rotas da série

| Método  | Rota                       | Perfil            |
| ------- | -------------------------- | ----------------- |
| `GET`   | `/expense-recurrences`     | qualquer          |
| `GET`   | `/expense-recurrences/:id` | qualquer          |
| `PATCH` | `/expense-recurrences/:id` | `ADMIN`, `BILLER` |
| `GET`   | `/earning-recurrences`     | qualquer          |
| `GET`   | `/earning-recurrences/:id` | qualquer          |
| `PATCH` | `/earning-recurrences/:id` | `ADMIN`, `BILLER` |

`PATCH` da série aceita só `endsOn`; o modelo muda pelo `?scope=following` de uma ocorrência, para
que nunca exista modelo alterado sem a ocorrência que o justifica. A listagem aceita `active=true`
(sem `ends_on` passado) e devolve
`RecurrenceResponse { id, description, typeId, amountCents, dayOfMonth, bankAccountId,
creditCardId?, startsOn, endsOn, nextOccurrenceOn, createdAt, updatedAt }`, e `ExpenseResponse` e
`EarningResponse` ganham `recurrenceId`.

### O banco

O `pg-boss` guarda filas e agendamentos nas próprias tabelas, no schema `pgboss`, na versão fixada
no `package.json`. Por padrão ele as cria e migra ao iniciar — o que a spec 0003 proíbe: a
aplicação não aplica migration no boot (INV-0003-04). Por isso:

- o script `jobs:migrate` (`package.json`) cria e migra o schema `pgboss` com a API de migração do
  próprio `pg-boss`, e roda no **initContainer**, depois de `migration:run` — o mesmo caminho das
  migrations TypeORM (ADR local 0001);
- a aplicação inicia o `pg-boss` com `migrate: false`; schema ausente ou em versão errada faz o
  início falhar, e o readiness mostra `checks.jobs: 'down'`;
- se o role `finances_app` não puder criar schema no banco, o script idempotente de provisionamento
  da spec 0003 passa a criá-lo, com `CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION finances_app`;
- os testes de integração rodam `jobs:migrate` junto das migrations, no banco do
  `docker-compose.test.yml` e no CI.

As tabelas de série são migrations TypeORM comuns, uma por módulo.

## Invariants

- **INV-0017-01:** nenhuma invariante financeira depende de job: saldo, limite e parcelas
  continuam resolvidos na transação do lançamento (ADR-0005, regra 1); jobs só aplicam transições
  por data.
- **INV-0017-02:** todo handler é idempotente e tolera atraso: rodar duas vezes, ou depois de dias
  parado, chega ao mesmo estado.
- **INV-0017-03:** `pg-boss` só é importado em `src/platform/jobs/`; módulos dependem da porta
  `JobQueue`. Verificado pelo gate `boundaries`.
- **INV-0017-09:** a aplicação nunca migra o schema `pgboss` no boot; a migração é do
  initContainer, como as demais (INV-0003-04).
- **INV-0017-04:** uma série tem no máximo uma ocorrência por data (`uq_*_recurrence_id_occurred_on`),
  e toda ocorrência `FIXED` pertence a uma série.
- **INV-0017-05:** ocorrências geradas nascem `FORECAST`; só a promoção, ou o usuário, as passa a
  `OPEN`, e a promoção move o limite do cartão na mesma transação.
- **INV-0017-06:** encerrar uma série nunca exclui ocorrência paga nem anterior à excluída.
- **INV-0017-07:** alterar o modelo de uma série nunca muda ocorrência anterior, promovida ou paga.
- **INV-0017-08:** falha de job é logada em nível `error` com `job`, `jobId` e `attempt`, e a
  exaustão das tentativas é distinguível.

## Error cases

| Situação                                                                                       | Comportamento exigido                                                                         |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **ERR-0017-01** `recurrenceEndsOn` em lançamento não `FIXED`, ou anterior a `occurredOn`       | `400`, `VALIDATION_ERROR` citando o campo                                                     |
| **ERR-0017-02** `?scope=following` em lançamento sem série                                     | `400`, `VALIDATION_ERROR` citando o parâmetro                                                 |
| **ERR-0017-03** `PATCH` de série com campo além de `endsOn`, ou `endsOn` anterior a `startsOn` | `400`, `VALIDATION_ERROR` citando o campo                                                     |
| **ERR-0017-04** `:id` de série inexistente                                                     | `404`, `EXPENSE_RECURRENCE_NOT_FOUND` ou `EARNING_RECURRENCE_NOT_FOUND`                       |
| **ERR-0017-05** Handler lança                                                                  | retentativa até a exaustão; log `error`; nenhum efeito parcial além do que o handler commitou |
| **ERR-0017-06** `pg-boss` não inicia com `JOBS_ENABLED=true`                                   | `checks.jobs: 'down'` e `503 NOT_READY` no readiness                                          |

## Acceptance criteria

- **AC-0017-01:** com `JOBS_ENABLED=true`, o boot inicia o `pg-boss`, registra os jobs dos módulos
  e agenda as sete rotinas; com `false`, nada é registrado e `checks.jobs` é `disabled`.
- **AC-0017-02:** um job que lança é tentado de novo até 3 vezes e loga cada falha, com
  `exhausted: true` na última (INV-0017-08).
- **AC-0017-03:** `enqueue` com a mesma `singletonKey` enquanto o primeiro está pendente não cria
  um segundo job.
- **AC-0017-04:** importar `pg-boss` fora de `src/platform/jobs/` reprova o gate `boundaries`
  (INV-0017-03).
- **AC-0017-05:** com o `pg-boss` parado, ou com o schema `pgboss` ausente, `GET /health/ready`
  responde `503` com `checks.jobs: 'down'`; a aplicação não cria o schema (INV-0017-09).
- **AC-0017-06:** criar em 10/03 uma despesa `FIXED` de 1500 no dia 10 cria a série e 13
  ocorrências — 10/03 com o status informado e de 10/04 a 10/03 do ano seguinte em `FORECAST` —, e
  publica 13 `ExpenseCreated`; com `occurredOn` 31/01, a de fevereiro cai no último dia do mês.
- **AC-0017-07:** `extend` um mês depois cria só a ocorrência do novo mês do horizonte; rodado duas
  vezes, cria zero na segunda; uma série com `ends_on` passado não ganha ocorrência (INV-0017-02,
  INV-0017-04).
- **AC-0017-08:** `promote(asOf)` passa a `OPEN` as ocorrências de série em `FORECAST` com
  `occurredOn <= asOf`; a de cartão consome o limite na mesma transação; um `FORECAST` sem série não
  muda (INV-0017-05).
- **AC-0017-09:** `PATCH` com `?scope=following` de 1500 para 1650 na ocorrência de junho muda o
  modelo, junho e as seguintes em `FORECAST`, e não muda maio nem uma ocorrência seguinte já paga
  (INV-0017-07).
- **AC-0017-10:** excluir a ocorrência de junho de uma série com abril pago, maio `OVERDUE` e
  agosto pago antecipadamente exclui junho, julho e os meses `FORECAST` seguintes, mantém abril,
  maio e agosto, e põe `ends_on` em 09/06 (INV-0017-06).
- **AC-0017-11:** `PATCH /expense-recurrences/:id` com `endsOn` exclui as `FORECAST` posteriores e
  mantém as demais; campo além de `endsOn` recebe `400`.
- **AC-0017-12:** as mesmas regras de criação, extensão, promoção, alteração e encerramento valem
  para receitas `FIXED`, com `RECEIVED` no papel de `PAID`.
- **AC-0017-13:** depois de três dias sem nenhum job rodar, uma execução de cada rotina deixa
  vencidas, faturas, extensões e promoções exatamente como se tivessem rodado todo dia
  (INV-0017-02).

## Test mapping

| Item                                                                                    | Teste                                                        |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| AC-0017-01, AC-0017-02, AC-0017-03, INV-0017-08                                         | `tests/integration/platform/jobs/pg-boss-job-queue.spec.ts`  |
| AC-0017-04, INV-0017-03                                                                 | gate `boundaries`                                            |
| AC-0017-05, ERR-0017-06, INV-0017-09                                                    | `tests/integration/platform/health/ready.spec.ts` (extensão) |
| AC-0017-06, AC-0017-07, INV-0017-04, ERR-0017-01                                        | `tests/integration/expenses/recurrence-generation.spec.ts`   |
| AC-0017-08, INV-0017-05                                                                 | `tests/integration/expenses/recurrence-promotion.spec.ts`    |
| AC-0017-09, AC-0017-10, AC-0017-11, INV-0017-06, INV-0017-07, ERR-0017-02 a ERR-0017-04 | `tests/integration/expenses/recurrence-changes.spec.ts`      |
| AC-0017-12                                                                              | `tests/integration/earnings/recurrence.spec.ts`              |
| AC-0017-13, INV-0017-01, INV-0017-02, ERR-0017-05                                       | `tests/integration/jobs/daily-routines.spec.ts`              |

## Open questions

Nenhuma.
