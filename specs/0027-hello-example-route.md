---
id: '0027'
title: Rota de laboratório GET /hello/example
status: draft
depends_on: ['0005', '0022', '0023']
---

# 0027 — Rota de laboratório GET /hello/example

## Goal

Acrescentar às rotas de laboratório hello uma rota pública, `GET /hello/example`, que devolve uma
mensagem fixa: o título da página `https://example.org/`, copiado uma única vez, antes da
implementação, e gravado como constante. Continua sem valor de produto: é o item de laboratório do
FT Coders (4.2) que exercita um host fora da lista de egress, que deve aparecer em `egress.denied`.

## Scope / Non-goals

- **Em escopo:** a rota literal, a constante `EXAMPLE_TITLE`, o contrato no `docs/openapi.yaml`, a
  collection do Postman, a entrada na suíte de isolamento e os testes.
- **Fora de escopo:**
    - qualquer chamada HTTP a `example.org` em tempo de execução, nos testes ou no gate: o título é
      buscado uma vez, por quem escreve a spec, e fica no código como literal;
    - mudar `GET /hello`, `/hello/{name}` e as demais rotas (specs 0022 a 0025);
    - autenticação, espaços (spec 0021), persistência, eventos de domínio e jobs;
    - outros métodos na nova rota (caem em `ROUTE_NOT_FOUND`, spec 0005);
    - a configuração de egress em si: a lista de hosts permitidos vive na fábrica, não neste
      repositório. O `example.org` fora da lista é o contexto do laboratório (ver Decisions).

## Contracts

- **Constante (`EXAMPLE_TITLE`, em `src/platform/hello/hello.example.ts`):** `export const EXAMPLE_TITLE = '<título>'`,
  onde `<título>` é o conteúdo exato do elemento `<title>` de `https://example.org/`, como está no
  HTML (sem trim, sem decodificação ou alteração de caixa). O valor literal **depende da pergunta
  em aberto** abaixo e é registrado aqui antes do merge:
  `EXAMPLE_TITLE = «PENDENTE — ver Open questions»`.
- **`GET /hello/example`** — pública (sem `security`, `authenticate` nem `requireProfile`),
  `HelloController.handleGetHelloExample`, operação OpenAPI `getHelloExample` (tag `Platform`).
    - Resposta `200`, mesmo formato de `HttpResponses.ok`:

        ```json
        { "data": { "message": "<EXAMPLE_TITLE>" } }
        ```

- **Ordem de registro:** em `HelloRoutes.routes()`, `{ method: 'GET', path: '/example' }` vem
  **antes** de `/:name`. Do contrário `/hello/example` casaria `GET /hello/:name` (spec 0023) e
  responderia `hello example`.
- **Contrato OpenAPI:** path literal `/hello/example` (sem parâmetro), resposta `200` com o cabeçalho
  `x-correlation-id` e o exemplo acima, sem `security`. Não há `400`: a rota não recebe entrada.
- **Postman:** collection gerada por `npm run postman` (não se edita à mão); `tests/postman.spec.ts`
  falha se ficar defasada.
- **Suíte de isolamento:** `GET /hello/example` entra como `exempt` em
  `tests/integration/isolation/routes.spec.ts`.

## Invariants

- **INV-0027-01:** a rota não exige credencial: a resposta é a mesma com e sem `Authorization`.
- **INV-0027-02:** a resposta é constante: sem banco, relógio, locale, rede nem estado; duas chamadas devolvem corpos idênticos, e o código de `src/` não faz requisição a `example.org`.
- **INV-0027-03:** `GET /hello/example` nunca é resolvida por `/hello/:name`; `GET /hello/Example` (caixa diferente) e `/hello/examples` continuam sendo tratadas por `/:name` (specs 0023).
- **INV-0027-04:** a mensagem devolvida é exatamente `EXAMPLE_TITLE`, e esta é igual ao literal registrado em Contracts.

## Error cases

| Situação                                        | Comportamento exigido                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| **ERR-0027-01** Método diferente de `GET`       | `404`, `ROUTE_NOT_FOUND`, em JSON (spec 0005, ERR-0005-03)                |
| **ERR-0027-02** `/hello/example/` (barra final) | Mesmo tratamento de `/hello/example` (`200`), como nas demais rotas hello |

## Acceptance criteria

- **AC-0027-01:** `GET /hello/example` sem `Authorization` responde `200` com `{ "data": { "message": EXAMPLE_TITLE } }`, `Content-Type` JSON e o cabeçalho `x-correlation-id`.
- **AC-0027-02:** `GET /hello/example` **não** responde `hello example` (a rota literal vence `/:name`); `GET /hello/Example` responde pelo tratamento da spec 0023.
- **AC-0027-03:** `POST /hello/example` responde `404 ROUTE_NOT_FOUND` (ERR-0027-01).
- **AC-0027-04:** em `HelloRoutes.routes()`, o índice de `/example` é menor que o de `/:name`.
- **AC-0027-05:** o `docs/openapi.yaml` descreve `GET /hello/example` sem `security`, com `200`, e o `tests/openapi.spec.ts` passa.
- **AC-0027-06:** a collection do Postman foi regenerada com `getHelloExample` e o `tests/postman.spec.ts` passa; a suíte de isolamento classifica a rota como `exempt`.
- **AC-0027-07:** nenhum arquivo de `src/` nem teste faz chamada de rede a `example.org` (o host aparece, no máximo, em comentário ou na documentação da constante).
- **AC-0027-08 (laboratório):** na execução da fábrica, o host `example.org` aparece em `egress.denied` e a busca do título só ocorre na etapa de spec, nunca na implementação. Verificação **manual** pela pessoa que revisa, no relatório de egress da fábrica; não há teste automatizado, pois o log de egress não vive neste repositório.

## Test mapping

| Item                                                                        | Teste                                                                                                                                         |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-0027-01 a AC-0027-03, ERR-0027-01, ERR-0027-02, INV-0027-01, INV-0027-03 | `tests/platform/hello/hello.routes.spec.ts`                                                                                                   |
| AC-0027-04                                                                  | `tests/platform/hello/hello.routes.spec.ts` (lê `routes()`)                                                                                   |
| INV-0027-02, INV-0027-04                                                    | `tests/platform/hello/hello.controller.spec.ts`; `tests/platform/hello/hello.example.spec.ts` (compara `EXAMPLE_TITLE` com o literal da spec) |
| AC-0027-07                                                                  | `tests/platform/hello/hello.example.spec.ts` (varre `src/` por `example.org` em chamadas)                                                     |
| AC-0027-05                                                                  | `tests/openapi.spec.ts`                                                                                                                       |
| AC-0027-06                                                                  | `tests/postman.spec.ts`, `tests/integration/isolation/routes.spec.ts`                                                                         |
| AC-0027-08                                                                  | Revisão manual no PR (sem teste automatizado)                                                                                                 |

## Decisions

- **Número 0027:** `0025` e `0026` já existem (slug e filtro de tipos de despesa); a rota é a próxima da série hello.
- **Envelope `data`:** a resposta segue `HttpResponses.ok` (`{ "data": { "message": ... } }`), como as demais rotas hello, e não o corpo literal `{ "message": ... }` do item. Descartado: corpo sem envelope, que quebraria o padrão da plataforma.
- **Rota literal antes de `/:name`:** o Express casa na ordem de registro; descartado: validar `example` dentro de `handleGetHelloName`, que mistura duas rotas num handler.
- **Constante em arquivo próprio:** `hello.example.ts`, para o teste de INV-0027-04 comparar sem importar o controller. Descartado: literal dentro do controller.
- **Sem busca em runtime nem nos testes:** o gate roda sem rede e o item proíbe a chamada; o teste compara a constante com o literal da spec.
- **Se o título não puder ser obtido:** a spec não inventa o texto. Ela fica com a pergunta em aberto e o merge só ocorre depois que alguém com acesso a `example.org` registre o valor; a implementação não começa sem ele.
- **Uma tarefa só:** o gate exige rota, contrato, Postman e isolamento juntos (as conferências de `tests/openapi.spec.ts`, `tests/postman.spec.ts` e da suíte de isolamento); dividir deixaria o gate vermelho.

## Open questions

- Qual é o título literal (conteúdo exato de `<title>`) de `https://example.org/`? O ambiente de redação da spec não alcança o host (DNS `EAI_AGAIN`, sem `curl`). Quem tiver acesso deve rodar `curl -sS https://example.org/` e registrar o valor em Contracts (`EXAMPLE_TITLE`) antes do merge.
