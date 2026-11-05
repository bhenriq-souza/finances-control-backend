---
id: '0024'
title: Rotas de laboratório GET /hello/{name}/upper e /hello/{name}/length
status: draft
depends_on: ['0005', '0023']
---

# 0024 — Rotas de laboratório GET /hello/{name}/upper e /hello/{name}/length

## Goal

Estender a rota de laboratório da spec 0023 com duas rotas públicas e independentes entre si:
`GET /hello/{name}/upper`, que devolve a saudação com o nome em maiúsculas, e
`GET /hello/{name}/length`, que devolve a quantidade de caracteres do nome. Continuam sem valor de
produto: exercitam a divisão de uma spec em tarefas que podem ser revisadas e entrar em produção
separadamente (item de laboratório do FT Coders, 2.13).

## Scope / Non-goals

- **Em escopo:** as duas rotas, o contrato no `docs/openapi.yaml`, a collection do Postman, as
  entradas na suíte de isolamento e os testes.
- **Fora de escopo:**
    - mudar `GET /hello` (spec 0022) ou `GET /hello/{name}` (spec 0023), que seguem válidas;
    - autenticação, espaços (spec 0021), persistência, eventos de domínio e jobs;
    - outros métodos nas novas rotas (caem em `ROUTE_NOT_FOUND`, spec 0005);
    - alterar a regra do nome ou o `nameParamsSchema`.

## Contracts

- **Regra do nome:** a mesma da spec 0023, reutilizando `nameParamsSchema` sem alteração
  (`^[\p{L}-]{1,40}$`, flag `u`, após a decodificação do parâmetro). Nome inválido responde `400`
  `VALIDATION_ERROR` com `path` igual a `["name"]`, como em 0023.
- **Independência:** cada rota tem seu próprio método no `HelloController`, sua própria entrada em
  `HelloRoutes`, sua própria operação no contrato e sua própria entrada na suíte de isolamento.
  Nenhuma depende da outra, nem em código nem em teste; as duas só compartilham `nameParamsSchema`
  e o tratamento de `URIError` já existentes em `HelloRoutes`.
- **`GET /hello/{name}/upper`** — pública (sem `security`, `authenticate` nem `requireProfile`),
  `HelloController.handleGetHelloUpper`, operação OpenAPI `getHelloNameUpper` (tag `Platform`).
    - Resposta `200`, mesmo formato de `HttpResponses.ok`:

        ```json
        { "data": { "message": "HELLO MARIA-JOSÉ" } }
        ```

        `data.message` é `HELLO ` (maiúsculas, um espaço) seguido do nome convertido com
        `String.prototype.toUpperCase()`, sem trim.

- **`GET /hello/{name}/length`** — pública, `HelloController.handleGetHelloLength`, operação
  OpenAPI `getHelloNameLength` (tag `Platform`).
    - Resposta `200`:

        ```json
        { "data": { "length": 10 } }
        ```

        `data.length` é um inteiro: a quantidade de pontos de código do nome como recebido
        (`[...name].length`), a mesma contagem que a regra do nome usa. Não depende de maiúsculas.

- **Contrato OpenAPI:** cada operação em seu path (`/hello/{name}/upper`, `/hello/{name}/length`),
  com o parâmetro de path `name` idêntico ao de `/hello/{name}` (spec 0023), resposta `200` com o
  cabeçalho `x-correlation-id` e o exemplo acima, e `400` por `$ref: ValidationFailed`. Sem `security`.
  No `length`, `length` é `type: integer`, `minimum: 1`, `maximum: 40`.
- **Postman:** a collection em `docs/postman/` é gerada por `npm run postman` (não se edita à mão);
  cada tarefa a regenera com a sua requisição. O `tests/postman.spec.ts` falha se ficar defasada.
- **Suíte de isolamento:** `GET /hello/:name/upper` e `GET /hello/:name/length` entram como `exempt`
  em `tests/integration/isolation/routes.spec.ts`, cada uma na tarefa da sua rota.

## Invariants

- **INV-0024-01:** as duas rotas não exigem credencial: a resposta é a mesma com e sem `Authorization`.
- **INV-0024-02:** a resposta depende só do `name`: sem banco, relógio nem estado; duas chamadas com o mesmo nome devolvem corpos idênticos.
- **INV-0024-03:** o `pattern` e os limites do parâmetro `name` nas duas operações do contrato aceitam exatamente os nomes que o schema zod aceita.
- **INV-0024-04:** cada rota pode ser entregue sem a outra: o repositório passa em `npm run check` com só uma delas implementada.

## Error cases

| Situação                                                                   | Comportamento exigido                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **ERR-0024-01** Nome com 41 caracteres ou mais                             | `400`, `VALIDATION_ERROR`, `details[0].path = ["name"]`    |
| **ERR-0024-02** Nome com dígito, espaço (`%20`), `_`, ponto, `@` etc.      | `400`, `VALIDATION_ERROR`                                  |
| **ERR-0024-03** Percent-encoding malformado (ex.: `/hello/%E0%A4%A/upper`) | `400`, `VALIDATION_ERROR`, sem detalhe do decodificador    |
| **ERR-0024-04** Método diferente de `GET` nas novas rotas                  | `404`, `ROUTE_NOT_FOUND`, em JSON (spec 0005, ERR-0005-03) |

## Acceptance criteria

Rota `upper`:

- **AC-0024-01:** `GET /hello/Maria/upper` sem `Authorization` responde `200` com `{ "data": { "message": "HELLO MARIA" } }`, `Content-Type` JSON e o cabeçalho `x-correlation-id`.
- **AC-0024-02:** `GET /hello/Jos%C3%A9/upper` responde `HELLO JOSÉ`; `GET /hello/Ana-Clara/upper` responde `HELLO ANA-CLARA`; `GET /hello/-/upper` responde `HELLO -`.
- **AC-0024-03:** um nome de 40 letras é aceito; um de 41 responde `400 VALIDATION_ERROR` (ERR-0024-01).
- **AC-0024-04:** `GET /hello/Ana%20Maria/upper`, `/hello/Ana2/upper` e `/hello/Ana_/upper` respondem `400 VALIDATION_ERROR`, cada item de `details` com `path`, `code` e `message` (ERR-0024-02); percent-encoding malformado também (ERR-0024-03).
- **AC-0024-05:** `POST /hello/Maria/upper` responde `404 ROUTE_NOT_FOUND` (ERR-0024-04).
- **AC-0024-06:** o `docs/openapi.yaml` descreve `GET /hello/{name}/upper` sem `security`, com `200` e `400` (`ValidationFailed`), e o `tests/openapi.spec.ts` passa.
- **AC-0024-07:** a collection do Postman foi regenerada com `getHelloNameUpper` e o `tests/postman.spec.ts` passa; a suíte de isolamento classifica a rota como `exempt`.

Rota `length`:

- **AC-0024-08:** `GET /hello/Maria/length` sem `Authorization` responde `200` com `{ "data": { "length": 5 } }`, `Content-Type` JSON e o cabeçalho `x-correlation-id`.
- **AC-0024-09:** `GET /hello/Jos%C3%A9/length` responde `4`; `GET /hello/Ana-Clara/length` responde `9`; `GET /hello/-/length` responde `1`; o `ß` conta `1` (`GET /hello/Stra%C3%9Fe/length` responde `6`).
- **AC-0024-10:** um nome de 40 letras responde `length` `40`; um de 41 responde `400 VALIDATION_ERROR` (ERR-0024-01).
- **AC-0024-11:** `GET /hello/Ana%20Maria/length`, `/hello/Ana2/length` e `/hello/Ana_/length` respondem `400 VALIDATION_ERROR` (ERR-0024-02); percent-encoding malformado também (ERR-0024-03).
- **AC-0024-12:** `POST /hello/Maria/length` responde `404 ROUTE_NOT_FOUND` (ERR-0024-04).
- **AC-0024-13:** o `docs/openapi.yaml` descreve `GET /hello/{name}/length` sem `security`, com `200` (`length` inteiro) e `400` (`ValidationFailed`), e o `tests/openapi.spec.ts` passa.
- **AC-0024-14:** a collection do Postman foi regenerada com `getHelloNameLength` e o `tests/postman.spec.ts` passa; a suíte de isolamento classifica a rota como `exempt`.

## Test mapping

| Item                                                          | Teste                                                                 |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| AC-0024-01 a AC-0024-05, ERR-0024-01 a ERR-0024-04 (`upper`)  | `tests/platform/hello/hello.routes.spec.ts`                           |
| AC-0024-08 a AC-0024-12, ERR-0024-01 a ERR-0024-04 (`length`) | `tests/platform/hello/hello.routes.spec.ts`                           |
| INV-0024-01                                                   | `tests/platform/hello/hello.routes.spec.ts`                           |
| INV-0024-02                                                   | `tests/platform/hello/hello.controller.spec.ts`                       |
| INV-0024-03, AC-0024-06, AC-0024-13                           | `tests/openapi.spec.ts`                                               |
| AC-0024-07, AC-0024-14                                        | `tests/postman.spec.ts`, `tests/integration/isolation/routes.spec.ts` |
| INV-0024-04                                                   | revisão em PR e `npm run check` em cada tarefa isoladamente           |

## Decisions

- **Duas tarefas, uma por rota, cada uma completa:** o gate exige que toda rota esteja no contrato
  OpenAPI, na collection do Postman e na suíte de isolamento; por isso código, contrato, Postman e
  isolamento de uma rota ficam na mesma tarefa (e no mesmo PR). Descartado: dividir por tipo de
  arquivo, que deixaria o gate vermelho entre as tarefas. As tarefas não dependem uma da outra e
  podem entrar em qualquer ordem; as duas editam os mesmos arquivos de contrato, então o segundo PR
  a entrar pode precisar de rebase e regeneração do Postman (`npm run postman`), sem conflito lógico.
- **`length` conta pontos de código:** igual à regra do nome da spec 0023. Como a regra só aceita
  letras (`\p{L}`) e hífen, não há ambiguidade com sequências combinantes. Descartado: `name.length`
  (unidades UTF-16), que divergiria para letras fora do plano básico.
- **`upper` usa `toUpperCase()`:** independe de locale. Letras cuja maiúscula tem mais caracteres
  (`ß` → `SS`) saem expandidas; o tamanho da mensagem não é restrito. Descartado: `toLocaleUpperCase`,
  que varia com o ambiente (INV-0024-02).
- **Mesma regra de nome e `400`:** reutiliza o `nameParamsSchema` e o `VALIDATION_ERROR` de 0023.
- **`message` em `upper` com prefixo `HELLO `:** segue literalmente o pedido (`HELLO {NAME}`).
- **Status das specs 0022/0023:** sem alteração.

## Open questions

Nenhuma.
