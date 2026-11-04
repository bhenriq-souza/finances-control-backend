---
id: '0023'
title: Rota de laboratório GET /hello/{name}
status: draft
depends_on: ['0005', '0022']
---

# 0023 — Rota de laboratório GET /hello/{name}

## Goal

Estender a rota de laboratório da spec 0022 com `GET /hello/{name}`, pública, que cumprimenta pelo nome
recebido na URL. Continua sem valor de produto: exercita o fluxo spec → card → tarefas filhas
(item de laboratório do FT Coders, 2.11) e a validação de parâmetro de rota.

## Scope / Non-goals

- **Em escopo:** a rota `GET /hello/{name}`, a validação do nome, o contrato no `docs/openapi.yaml`, a
  collection do Postman, a entrada na suíte de isolamento e os testes.
- **Fora de escopo:**
    - mudar `GET /hello` (spec 0022, que segue válida);
    - autenticação, espaços (spec 0021), persistência, eventos de domínio e jobs;
    - outros métodos em `/hello/{name}` (caem em `ROUTE_NOT_FOUND`, spec 0005);
    - normalização Unicode do nome (ver decisões).

## Contracts

- **Rota:** `GET /hello/{name}`, pública (sem `security`, sem `authenticate` nem `requireProfile`),
  no `HelloRoutes` existente (`/:name`), montado em `/hello`.
- **Regra do nome** (após o Express decodificar o parâmetro): 1 a 40 caracteres, cada um uma letra
  Unicode (`\p{L}`, com ou sem acento, qualquer alfabeto) ou hífen `-`, em qualquer posição.
  Regex com a flag `u`: `^[\p{L}-]{1,40}$`. O comprimento conta pontos de código, não bytes.
  Validada por schema zod, como as demais rotas (`nameParamsSchema.parse(req.params)`).
- **Resposta `200`:** `Content-Type: application/json`, mesmo formato de `HttpResponses.ok`:

    ```json
    { "data": { "message": "hello Maria-José" } }
    ```

    `data.message` é `hello ` (minúsculas, um espaço) seguido do nome exatamente como recebido,
    sem trim nem mudança de caixa.

- **Resposta `400`:** nome fora da regra responde `400` com `VALIDATION_ERROR` e `details` no formato
  `ValidationIssue` (spec 0005, resposta `ValidationFailed`), com `path` igual a `["name"]`.
- **Contrato OpenAPI:** operação `getHelloName` (tag `Platform`) em `/hello/{name}`, com parâmetro de
  path `name` (`string`, `minLength: 1`, `maxLength: 40`, `pattern` equivalente à regex), resposta
  `200` com o cabeçalho `x-correlation-id` e o exemplo acima, e resposta `400` por
  `$ref: ValidationFailed`. Sem `security`.
- **Postman:** a collection em `docs/postman/` é gerada do `openapi.yaml` por `npm run postman`
  (não se edita à mão). Regenerá-la inclui a requisição de `getHelloName`; o `tests/postman.spec.ts`
  falha se ficar defasada.
- **Suíte de isolamento:** `GET /hello/:name` entra como `exempt` em
  `tests/integration/isolation/routes.spec.ts`, como `GET /hello`.

## Invariants

- **INV-0023-01:** `GET /hello/{name}` não exige credencial: a resposta é a mesma com e sem `Authorization`.
- **INV-0023-02:** a resposta depende só do `name`: sem banco, relógio nem estado; duas chamadas com o mesmo nome devolvem corpos idênticos.
- **INV-0023-03:** o `pattern` e os limites do contrato OpenAPI aceitam exatamente os nomes que o schema zod aceita.

## Error cases

| Situação                                                              | Comportamento exigido                                                   |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **ERR-0023-01** Nome com 41 caracteres ou mais                        | `400`, `VALIDATION_ERROR`, `details[0].path = ["name"]`                 |
| **ERR-0023-02** Nome com dígito, espaço (`%20`), `_`, ponto, `@` etc. | `400`, `VALIDATION_ERROR`                                               |
| **ERR-0023-03** Percent-encoding malformado (ex.: `/hello/%E0%A4%A`)  | `400`, `VALIDATION_ERROR`, sem detalhe do decodificador na resposta     |
| **ERR-0023-04** Método diferente de `GET`                             | `404`, `ROUTE_NOT_FOUND`, em JSON (spec 0005, ERR-0005-03)              |
| **ERR-0023-05** `/hello/` (nome vazio)                                | Cai em `GET /hello` (spec 0022): `200` com `hello world`, sem validação |

## Acceptance criteria

- **AC-0023-01:** `GET /hello/Maria` sem `Authorization` responde `200` com `{ "data": { "message": "hello Maria" } }`.
- **AC-0023-02:** nomes com acento e hífen são aceitos: `GET /hello/Jos%C3%A9` responde `hello José`; `GET /hello/Ana-Clara` responde `hello Ana-Clara`; `GET /hello/-` responde `hello -`.
- **AC-0023-03:** um nome de 40 letras é aceito; um de 41 responde `400 VALIDATION_ERROR` (ERR-0023-01).
- **AC-0023-04:** `GET /hello/Ana%20Maria`, `/hello/Ana2` e `/hello/Ana_` respondem `400 VALIDATION_ERROR` (ERR-0023-02), e cada item de `details` tem `path`, `code` e `message`.
- **AC-0023-05:** percent-encoding malformado responde `400 VALIDATION_ERROR` (ERR-0023-03).
- **AC-0023-06:** a resposta `200` tem `Content-Type` JSON e o cabeçalho `x-correlation-id`.
- **AC-0023-07:** `POST /hello/Maria` responde `404 ROUTE_NOT_FOUND`; `GET /hello/` segue respondendo `hello world` (ERR-0023-04, ERR-0023-05).
- **AC-0023-08:** o `docs/openapi.yaml` descreve `GET /hello/{name}` sem `security`, com `200` e `400` (`ValidationFailed`), e o `tests/openapi.spec.ts` passa.
- **AC-0023-09:** a collection do Postman foi regenerada com `getHelloName` e o `tests/postman.spec.ts` passa; a suíte de isolamento classifica a rota como `exempt`.

## Test mapping

| Item                                                                      | Teste                                                                 |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| AC-0023-01, AC-0023-02, AC-0023-06, INV-0023-01                           | `tests/platform/hello/hello.routes.spec.ts`                           |
| AC-0023-03, AC-0023-04, AC-0023-05, ERR-0023-01, ERR-0023-02, ERR-0023-03 | `tests/platform/hello/hello.routes.spec.ts`                           |
| AC-0023-07, ERR-0023-04, ERR-0023-05                                      | `tests/platform/hello/hello.routes.spec.ts`                           |
| INV-0023-02                                                               | `tests/platform/hello/hello.controller.spec.ts`                       |
| INV-0023-03                                                               | `tests/openapi.spec.ts`                                               |
| AC-0023-08                                                                | `tests/openapi.spec.ts`                                               |
| AC-0023-09                                                                | `tests/postman.spec.ts`, `tests/integration/isolation/routes.spec.ts` |

## Decisions

- **`400`, não `422`:** a plataforma já usa `400 VALIDATION_ERROR` para entrada inválida (spec 0005,
  AC-0005-06). Descartado: `422`, que criaria um segundo caminho de erro.
- **`\p{L}`, não só letras latinas:** "letras com acento" fica simples e não exclui nomes de outros
  alfabetos. Descartado: lista de letras latinas acentuadas, longa e arbitrária.
- **Hífen em qualquer posição:** a regra do item não restringe; `-` sozinho é válido.
- **Sem normalização Unicode:** o nome é ecoado como chegou. Letra decomposta (letra + acento
  combinante, NFD) não casa `\p{L}` e é rejeitada; descartado normalizar para NFC para manter a
  rota previsível e sem transformação.
- **Espaço é inválido:** `%20` decodifica para espaço, que não está na regra.
- **Postman:** vive neste repositório e é gerado do contrato; por isso não há edição manual, só
  `npm run postman`.
- **Spec 0022:** segue `implemented` e sem alteração de contrato; só teve a pergunta em aberto
  fechada (envelope JSON já implementado).

## Open questions

Nenhuma.
