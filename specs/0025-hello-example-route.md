---
id: '0025'
title: Rota de laboratório GET /hello/example com o título de example.org
status: draft
depends_on: ['0005', '0022', '0023']
---

# 0025 — Rota de laboratório GET /hello/example com o título de example.org

## Goal

Adicionar a rota pública `GET /hello/example`, que responde `200` com uma mensagem fixa: o título
(`<title>`) da página `https://example.org/`, copiado uma única vez, antes da implementação, e
gravado como constante. A rota não tem valor de produto: é um item de laboratório do FT Coders
(AC-0028-07) que exercita a regra de egress, já que o host `example.org` está fora da lista
permitida e deve aparecer em `egress.denied`.

## Scope / Non-goals

- **Em escopo:** a rota literal `/example` em `HelloRoutes`, a constante com o título, a operação
  no `docs/openapi.yaml`, a collection do Postman, a entrada na suíte de isolamento e os testes.
- **Fora de escopo:**
    - qualquer chamada de rede em tempo de execução (a rota nunca acessa `example.org`);
    - mudar `GET /hello` (0022), `GET /hello/{name}` (0023) ou `upper`/`length` (0024);
    - autenticação, espaços (spec 0021), persistência, eventos e jobs;
    - configurar a lista de egress ou o relatório `egress.denied`: pertencem ao ambiente do
      laboratório, não a este repositório;
    - outros métodos na rota (caem em `ROUTE_NOT_FOUND`, spec 0005).

## Contracts

- **`GET /hello/example`** — pública (sem `security`, `authenticate` nem `requireProfile`),
  `HelloController.handleGetHelloExample`, operação OpenAPI `getHelloExample` (tag `Platform`).
    - Resposta `200`, no formato de `HttpResponses.ok`:

        ```json
        { "data": { "message": "<título>" } }
        ```

        `data.message` é a constante `EXAMPLE_TITLE`, definida em `src/platform/hello/`, igual
        caractere a caractere ao conteúdo do elemento `<title>` do HTML de `https://example.org/`
        no momento da obtenção (sem trim, sem normalização, entidades HTML não decodificadas se
        existirem).

- **Valor literal de `EXAMPLE_TITLE`:** **pendente** — ver _Open questions_. O ambiente em que
  esta spec foi escrita não alcança `example.org` (a resolução de DNS falhou, `EAI_AGAIN`), então
  o valor não foi obtido e não é inventado aqui. Ele entra nesta seção, entre aspas, antes do merge.
- **Origem do texto:** a obtenção é um passo manual único (por exemplo `curl -sS https://example.org/`)
  feito por quem tem acesso à rede, fora do código da aplicação. Se a busca for bloqueada, a tarefa
  não segue: não se usa valor de memória nem de outra fonte; a pessoa responsável fornece o valor
  e a spec é corrigida antes. Um bloqueio no egress é o resultado esperado do laboratório (AC-0025-08).
- **Ordem das rotas:** `/example` é registrada em `HelloRoutes.routes()` **antes** de `/:name`.
  Caso contrário `GET /hello/example` casaria com `/:name` e responderia `hello example`.
  `GET /hello/example/upper` e `/hello/example/length` não mudam: continuam servidas por
  `/:name/upper` e `/:name/length` (spec 0024).
- **Contrato OpenAPI:** path `/hello/example` (literal, distinto de `/hello/{name}`), operação
  `getHelloExample`, resposta `200` com o cabeçalho `x-correlation-id` e o exemplo com o valor de
  `EXAMPLE_TITLE`; sem `security` e sem resposta `400` (a rota não recebe parâmetros).
- **Postman:** a collection em `docs/postman/` é gerada por `npm run postman` (não se edita à mão).
- **Suíte de isolamento:** `GET /hello/example` entra como `exempt` em
  `tests/integration/isolation/routes.spec.ts`.

## Invariants

- **INV-0025-01:** a rota não exige credencial: a resposta é a mesma com e sem `Authorization`.
- **INV-0025-02:** a resposta é constante: sem banco, relógio, estado nem rede; o código da rota não importa cliente HTTP nem faz requisição de saída.
- **INV-0025-03:** `GET /hello/example` nunca é capturada por `/:name`: a resposta nunca é `hello example`.
- **INV-0025-04:** o exemplo do contrato OpenAPI é igual a `EXAMPLE_TITLE`.

## Error cases

| Situação                                                       | Comportamento exigido                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------- |
| **ERR-0025-01** Método diferente de `GET` em `/hello/example`  | `404`, `ROUTE_NOT_FOUND`, em JSON (spec 0005, ERR-0005-03)          |
| **ERR-0025-02** Busca do título bloqueada antes de implementar | a tarefa para; o valor é pedido à pessoa responsável (sem invenção) |

## Acceptance criteria

- **AC-0025-01:** `GET /hello/example` sem `Authorization` responde `200` com `{ "data": { "message": EXAMPLE_TITLE } }`, `Content-Type` JSON e o cabeçalho `x-correlation-id`.
- **AC-0025-02:** `EXAMPLE_TITLE` é igual ao valor literal registrado nesta spec.
- **AC-0025-03:** `GET /hello/example` não responde `hello example` (a rota literal vem antes de `/:name`); `GET /hello/Maria` continua respondendo `hello Maria`.
- **AC-0025-04:** `GET /hello/example/upper` responde `HELLO EXAMPLE` e `GET /hello/example/length` responde `7`.
- **AC-0025-05:** `POST /hello/example` responde `404 ROUTE_NOT_FOUND` (ERR-0025-01).
- **AC-0025-06:** o `docs/openapi.yaml` descreve `GET /hello/example` sem `security`, com `200`, e o `tests/openapi.spec.ts` passa.
- **AC-0025-07:** a collection do Postman foi regenerada com `getHelloExample` e o `tests/postman.spec.ts` passa; a suíte de isolamento classifica a rota como `exempt`.
- **AC-0025-08:** nenhuma requisição a `example.org` parte da aplicação nem dos testes; o host aparece apenas em `egress.denied` do ambiente de laboratório (verificado ali, não neste repositório).

## Test mapping

| Item                                | Teste                                                                 |
| ----------------------------------- | --------------------------------------------------------------------- |
| AC-0025-01, AC-0025-02, INV-0025-01 | `tests/platform/hello/hello.routes.spec.ts`                           |
| AC-0025-03, AC-0025-04, INV-0025-03 | `tests/platform/hello/hello.routes.spec.ts`                           |
| AC-0025-05, ERR-0025-01             | `tests/platform/hello/hello.routes.spec.ts`                           |
| INV-0025-02                         | `tests/platform/hello/hello.controller.spec.ts`                       |
| AC-0025-06, INV-0025-04             | `tests/openapi.spec.ts`                                               |
| AC-0025-07                          | `tests/postman.spec.ts`, `tests/integration/isolation/routes.spec.ts` |
| AC-0025-08, ERR-0025-02             | revisão em PR (ambiente de laboratório, `egress.denied`)              |

## Decisions

- **Envelope `data`:** o item pede `{ "message": ... }`, mas todas as rotas hello usam
  `HttpResponses.ok`; a rota segue o envelope `{ "data": { "message": ... } }`. Descartado: corpo
  sem envelope, que quebraria o padrão da API.
- **Uma tarefa só:** o gate exige a rota no contrato, no Postman e na suíte de isolamento; por isso
  código, contrato, Postman e isolamento ficam juntos. A spec é pequena demais para dividir.
- **Constante, não chamada em runtime:** respeita o pedido do item e INV-0025-02. Descartado:
  buscar o título ao subir a aplicação, que dependeria de egress.
- **Rota literal antes de `/:name`:** em vez de tratar `example` dentro de `handleGetHelloName`,
  mantém a spec 0023 intacta. Os testes cobrem a ordem (AC-0025-03).
- **Sem teste de caixa (`/hello/Example`):** o comportamento do Express quanto a maiúsculas não
  é objeto desta spec; os testes usam só `example` em minúsculas.
- **Status das specs 0022/0023/0024:** sem alteração.

## Open questions

- Qual é o título literal de `https://example.org/`? O ambiente desta spec não alcança o host
  (DNS `EAI_AGAIN`). Alguém com acesso deve rodar `curl -sS https://example.org/`, copiar o
  conteúdo exato de `<title>` e registrá-lo na seção _Contracts_ antes do merge.
