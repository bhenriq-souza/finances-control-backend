---
id: '0004'
title: Eventos de domínio — dispatcher in-process e publicação pós-commit
status: draft
depends_on: ['0000', '0002', '0003']
---

# 0004 — Eventos de domínio

## Goal

Dar aos módulos de domínio um único meio de comunicar, entre contextos, os efeitos que **não** são
invariantes financeiras: um evento de domínio, publicado dentro da transação que o originou e
entregue **depois do commit**, in-process, aos handlers que outros módulos registraram. Ao final, a
spec `0012` (expenses) e as seguintes só precisam declarar seus eventos e seus handlers — sem
reabrir como um evento nasce, quando é entregue, o que acontece quando um handler falha, nem como a
entrega passará a ser diferida (outbox, `pg-boss`) sem mudar quem publica ou quem consome
([ADR-0005](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0005-queue.md)).

## Scope / Non-goals

- **Em escopo:** o contrato do evento de domínio; o dispatcher in-process e sua porta; o escopo de
  transação que acumula eventos e os despacha após o commit; a política de falha de handler; o
  catálogo de eventos em `src/events/` e a regra de fronteira que o protege; o registro de
  subscribers na composição da aplicação; a observabilidade mínima (log por evento e por falha).
- **Fora de escopo:** os eventos concretos de cada contexto (`ExpenseCreated`, `ExpensePaid`,
  `StatementClosed`, …), declarados pelas specs de domínio que os publicam — a `0012` traz os dois
  primeiros; entrega diferida ou garantida (outbox, ADR-0005 regra 4) e jobs assíncronos com
  `pg-boss` (FCB-015) — esta spec só garante que a porta não muda quando isso chegar; broker
  externo; qualquer invariante financeira: saldo, limite disponível e parcelas **nunca** passam por
  evento ([ADR-0003](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0003-architecture-style.md),
  regra 4).

## Contracts

### Vocabulário

- **Evento de domínio:** fato do negócio que já aconteceu, nomeado no particípio
  (`ExpenseCreated`), imutável, publicado pelo módulo dono do agregado.
- **Publicar:** registrar o evento no escopo da transação corrente. Publicar **não** entrega.
- **Despachar:** entregar o evento aos handlers inscritos. Só acontece depois do commit.
- **Handler:** função de um módulo consumidor, inscrita para um nome de evento.

### Envelope do evento

Declarado em `src/platform/events/domain-event.ts` e reexportado por `src/platform/index.ts`:

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

type DomainEvent<TName extends string = string, TPayload extends JsonObject = JsonObject> = {
    readonly name: TName;
    readonly occurredAt: Date;
    readonly correlationId: string | null;
    readonly payload: TPayload;
};
```

- `name` é único na aplicação, em PascalCase `<Agregado><Particípio>` — os nomes do ADR-0005 são
  literais: `ExpenseCreated`, `ExpensePaid`, `StatementClosed`.
- `occurredAt` e `correlationId` são preenchidos pelo escopo de transação no `publish`, nunca pelo
  módulo: o primeiro com o relógio do processo, o segundo com `RequestContext.getCorrelationId()`
  (`null` fora de requisição — jobs, testes).
- `payload` é um objeto JSON: só identificadores e escalares que o consumidor precisa. **Nunca**
  carrega entidade, repositório ou `EntityManager` — o evento atravessa a fronteira de módulo, e a
  regra 2 do ADR-0003 vale para o que vai dentro dele. Dinheiro no payload é inteiro de centavos,
  em campo com sufixo `Cents` (INV-0000-04).
- Um evento é serializável por construção (`JsonObject`): é o que permite gravá-lo numa tabela
  `outbox` no futuro sem tocar em quem publica.

### Catálogo de eventos: `src/events/`

Decidido no [ADR local 0002](adr/0002-domain-event-catalog.md). Módulos de domínio não podem
importar uns dos outros (gate `boundaries`), e isso vale também para tipos. O contrato de um evento
precisa, portanto, viver num lugar que publicador e consumidor possam importar:

- `src/events/<módulo>.events.ts` declara os eventos que aquele módulo publica: para cada um, a
  constante com o nome e o tipo do evento.

    ```ts
    // src/events/expenses.events.ts (exemplo, contrato real na spec 0012)
    export const EXPENSE_CREATED = 'ExpenseCreated' as const;
    export type ExpenseCreated = DomainEvent<
        typeof EXPENSE_CREATED,
        { expenseId: string; amountCents: number; bankAccountId: string | null }
    >;
    ```

- `src/events/index.ts` reexporta tudo; é o único caminho de import (regra 1 do ADR-0003).
- O catálogo contém **apenas tipos e constantes**. Importa somente de `src/platform`. Nunca importa
  de módulo de domínio, e `src/platform` nunca importa do catálogo. As duas proibições entram no
  `.dependency-cruiser.cjs` como regras de erro (spec 0002, gate `boundaries`).
- Um módulo publica **só os eventos do seu próprio arquivo** no catálogo. Consumir, qualquer módulo
  pode — inclusive o próprio publicador.

### Porta do dispatcher

`src/platform/events/domain-event-dispatcher.ts`:

```ts
type DomainEventHandler<TEvent extends DomainEvent = DomainEvent> = (
    event: TEvent,
) => Promise<void> | void;

type Unsubscribe = () => void;

interface DomainEventDispatcher {
    subscribe<TEvent extends DomainEvent>(
        name: TEvent['name'],
        handler: DomainEventHandler<TEvent>,
    ): Unsubscribe;
    dispatch(events: readonly DomainEvent[]): Promise<void>;
}
```

- `subscribe` é idempotente para o mesmo par `(name, handler)`: inscrever duas vezes a mesma
  função não a chama duas vezes. Devolve a função que desfaz a inscrição.
- `dispatch` entrega os eventos **na ordem de publicação** e, para cada evento, chama os handlers
  **na ordem de inscrição**, um de cada vez, aguardando cada um. A promessa resolve quando o último
  terminou. Evento sem handler é entregue a ninguém e não é erro.
- **Falha de handler é isolada:** um handler que lança não impede os demais nem os eventos
  seguintes, e `dispatch` resolve mesmo assim. A falha é logada em nível `error` com `event`,
  `handler` (o `name` da função, ou `anonymous`) e `correlationId`. O trabalho que originou o
  evento já foi commitado — devolver erro ao cliente mentiria sobre o que aconteceu. Enquanto não
  houver outbox, um handler que falha **perde** aquele efeito; é o preço aceito pelo ADR-0005 para
  efeitos que toleram atraso, e é o que o item 4 do ADR resolve quando chegar.
- Cada evento despachado é logado em nível `debug` com `event`, `handlers` (quantidade) e
  `correlationId`.
- A implementação inicial é `InProcessDomainEventDispatcher`, em
  `src/platform/events/in-process-dispatcher.ts`, registrada no container como singleton sob
  `DomainEventDispatcherSymbol`. Módulos dependem **da porta e do símbolo**, nunca da classe.

### Escopo de transação e publicação pós-commit

`src/platform/events/transaction-runner.ts`:

```ts
type TransactionScope = {
    readonly manager: EntityManager;
    publish(event: Omit<DomainEvent, 'occurredAt' | 'correlationId'>): void;
};

interface TransactionRunner {
    run<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T>;
}
```

- `run` abre uma transação no `DataSource` da plataforma (`dataSource.transaction`), executa
  `work` com o `manager` daquela transação e um `publish` que **acumula** eventos no escopo.
- **Commit → despacho.** Se `work` resolve, a transação é commitada e, só então, os eventos
  acumulados são entregues por `DomainEventDispatcher.dispatch`, na ordem em que foram publicados.
  `run` resolve com o resultado de `work` depois de o despacho terminar.
- **Rollback → descarte.** Se `work` rejeita, a transação é revertida, os eventos acumulados são
  descartados sem despacho, e o erro propaga inalterado.
- `publish` depois de o escopo encerrar (handler que guardou a referência, callback tardio) lança
  `Error` com mensagem `transaction scope is closed` — é erro de programação, não de negócio.
- **Não existe outro caminho para publicar.** A plataforma não expõe `publish` fora de um escopo:
  é a construção que garante que nenhum evento sai antes do commit.
- `TransactionRunner` é registrado no container como singleton sob `TransactionRunnerSymbol`, com
  `DomainEventDispatcherSymbol`, `DatabaseConnectionSymbol` e `RequestContextSymbol` injetados.

### Como os módulos usam

- **Serviço que muda estado e tem efeito para outro contexto** usa `TransactionRunner.run` no lugar
  de `dataSource.transaction`, faz toda a escrita com `scope.manager` e chama `scope.publish` ao
  final do trabalho. Serviço que não publica evento pode continuar usando `dataSource.transaction`.
- **Invariante entre módulos** (a despesa que move o saldo da conta, spec `0012`) **não** é evento:
  o módulo dono do número expõe, na sua interface pública, um método que recebe o `EntityManager`
  da transação em curso e escreve com ele. Um serviço público chamado dentro de um escopo recebe o
  `manager` e **nunca abre transação própria** — abrir `dataSource.transaction` dentro de outra
  transação usa uma segunda conexão, e as duas passam a disputar locks.
- **Handler que precisa escrever** abre o seu próprio `TransactionRunner.run`, e os eventos que ele
  publicar são despachados depois do **seu** commit. O aninhamento é permitido e finito por
  construção: cada nível só despacha após commitar.
- **Handler é registrado na composição**, não em `platform`. Um módulo consumidor exporta na sua
  interface pública uma classe que implementa:

    ```ts
    interface DomainEventSubscriber {
        subscribe(dispatcher: DomainEventDispatcher): void;
    }
    ```

    e a declara em `src/api.config.ts`, no campo novo e opcional `subscribers` de `ApiModule`
    (`Array<Omit<ApiProvider, 'scope'>>`). `registerApiModules` registra cada uma como singleton,
    resolve-a e chama `subscribe(dispatcher)` uma vez, depois de registrar os `provides` do módulo
    e antes de publicar o router.

### Símbolos e interface pública da plataforma

`src/platform/symbols/index.ts` ganha `DomainEventDispatcherSymbol` e `TransactionRunnerSymbol`.
`src/platform/index.ts` passa a exportar `DomainEvent`, `JsonObject`, `DomainEventHandler`,
`DomainEventDispatcher`, `DomainEventSubscriber`, `TransactionScope`, `TransactionRunner` e os
dois símbolos. `InProcessDomainEventDispatcher` e a classe do runner **não** são exportadas: quem
precisa delas é o `container.ts`, que já importa da plataforma por caminho interno.

## Invariants

- **INV-0004-01:** nenhum evento é entregue antes do commit da transação que o publicou; uma
  transação revertida não entrega evento algum.
- **INV-0004-02:** não existe caminho para publicar um evento fora de um `TransactionScope`.
- **INV-0004-03:** nenhuma invariante financeira depende de evento: saldo, limite disponível e
  parcelas resolvem-se com o `EntityManager` da transação em curso, por chamada síncrona à
  interface pública do módulo dono (ADR-0003, regra 4; ADR-0005, regra 1).
- **INV-0004-04:** falha de handler nunca altera o resultado da operação que originou o evento nem
  impede os demais handlers; é sempre logada com `event`, `handler` e `correlationId`.
- **INV-0004-05:** eventos são despachados na ordem de publicação e handlers na ordem de inscrição,
  um por vez; `run` só resolve depois de o despacho terminar.
- **INV-0004-06:** o payload de um evento é um objeto JSON com identificadores e escalares; nunca
  entidade, repositório ou conexão. Dinheiro no payload é inteiro de centavos (INV-0000-04).
- **INV-0004-07:** `src/events/` contém apenas tipos e constantes; importa só de `src/platform`;
  nenhum arquivo de `src/platform/` importa de `src/events/`. Verificado pelo gate `boundaries`.
- **INV-0004-08:** um módulo publica apenas os eventos declarados no seu próprio arquivo do
  catálogo (`src/events/<módulo>.events.ts`).
- **INV-0004-09:** módulos dependem da porta `DomainEventDispatcher` e dos símbolos, nunca da
  implementação in-process; trocar a implementação não altera nenhum módulo de domínio.
- **INV-0004-10:** `platform` continua sem conhecer módulo de domínio (INV-0003-09): o dispatcher
  não sabe quais eventos existem, e os handlers são registrados pela composição em `src/`.

## Error cases

| Situação                                                                              | Comportamento exigido                                                                                                     |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **ERR-0004-01** Handler lança ou rejeita                                              | Log `error` com `event`, `handler`, `correlationId` e o erro; demais handlers e eventos seguem; `run` resolve normalmente |
| **ERR-0004-02** `work` rejeita                                                        | Rollback; eventos acumulados descartados; nenhum handler chamado; o erro original propaga inalterado                      |
| **ERR-0004-03** `publish` após o escopo encerrar                                      | `Error('transaction scope is closed')`; nada é acumulado nem despachado                                                   |
| **ERR-0004-04** Mesmo handler inscrito duas vezes                                     | Segunda inscrição ignorada; o handler é chamado uma vez por evento                                                        |
| **ERR-0004-05** Import de módulo de domínio no catálogo, ou do catálogo em `platform` | Gate `boundaries` reprova com a regra nomeada                                                                             |
| **ERR-0004-06** Evento sem handler inscrito                                           | Despacho sem efeito; log `debug` com `handlers: 0`; não é erro                                                            |

## Acceptance criteria

- **AC-0004-01:** um handler inscrito para `name` é chamado com o evento completo — `name`,
  `payload`, `occurredAt` preenchido e `correlationId` igual ao da requisição — e um handler
  inscrito para outro nome não é chamado.
- **AC-0004-02:** com dois handlers para o mesmo evento e dois eventos publicados, a ordem de
  chamada é evento 1 → handler A → handler B, depois evento 2 → handler A → handler B, e o segundo
  handler só começa depois de o primeiro resolver (INV-0004-05).
- **AC-0004-03:** um handler que lança não impede o handler seguinte nem o evento seguinte;
  `dispatch` resolve; o erro aparece uma vez no log com `event`, `handler` e `correlationId`
  (ERR-0004-01, INV-0004-04).
- **AC-0004-04:** inscrever o mesmo handler duas vezes resulta em uma chamada por evento; chamar o
  `Unsubscribe` devolvido faz o handler deixar de ser chamado (ERR-0004-04).
- **AC-0004-05:** dentro de `run`, uma linha gravada por `scope.manager` e um evento publicado
  resultam em: handler chamado **depois** do commit — dentro do handler, uma consulta pela conexão
  padrão do `DataSource` (fora do escopo) já encontra a linha (INV-0004-01).
- **AC-0004-06:** dentro de `run`, uma linha gravada, um evento publicado e um `throw` em seguida
  resultam em: a linha não existe após `run` rejeitar, nenhum handler foi chamado e o erro recebido
  é o mesmo objeto lançado (ERR-0004-02).
- **AC-0004-07:** `run` só resolve depois de todos os handlers terminarem: um handler que espera 50
  ms atrasa a resolução de `run` em pelo menos isso (INV-0004-05).
- **AC-0004-08:** guardar o `scope` e chamar `publish` depois de `run` resolver lança
  `Error('transaction scope is closed')` (ERR-0004-03).
- **AC-0004-09:** um handler que abre o seu próprio `run` e publica outro evento vê esse segundo
  evento despachado depois do commit do seu próprio escopo, e o `run` externo resolve depois disso.
- **AC-0004-10:** `registerApiModules` com um módulo que declara `subscribers` registra a classe,
  chama `subscribe(dispatcher)` exatamente uma vez e antes de publicar o router; módulo sem
  `subscribers` segue como hoje.
- **AC-0004-11:** um arquivo em `src/events/` que importe de `src/accounts/` e um arquivo em
  `src/platform/` que importe de `src/events/` são reprovados pelo gate `boundaries`, cada um
  citando a regra que violou (INV-0004-07, ERR-0004-05).
- **AC-0004-12:** o `DomainEventDispatcher` e o `TransactionRunner` resolvidos pelo container são
  sempre a mesma instância.

## Test mapping

| Item                                                                                     | Teste                                                                                                 |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| AC-0004-01 a AC-0004-04, INV-0004-04, INV-0004-05, ERR-0004-01, ERR-0004-04, ERR-0004-06 | `tests/platform/events/in-process-dispatcher.spec.ts`                                                 |
| AC-0004-07, AC-0004-08, INV-0004-02, ERR-0004-02, ERR-0004-03                            | `tests/platform/events/transaction-runner.spec.ts` (unidade, `DataSource` substituído por dublê)      |
| AC-0004-05, AC-0004-06, AC-0004-09, INV-0004-01                                          | `tests/integration/platform/events/transaction-runner.spec.ts` (banco real, tabela criada pelo teste) |
| AC-0004-10, INV-0004-10                                                                  | `tests/platform/api/register-api-modules.spec.ts`                                                     |
| AC-0004-11, INV-0004-07, ERR-0004-05                                                     | gate `boundaries` (regras novas em `.dependency-cruiser.cjs`); saída da violação colada no PR         |
| AC-0004-12, INV-0004-09                                                                  | `tests/platform/events/container.spec.ts`                                                             |
| INV-0004-03, INV-0004-06, INV-0004-08                                                    | revisão de PR; testes de domínio das specs `0012`+ que publicam eventos                               |

## Open questions

Nenhuma.
