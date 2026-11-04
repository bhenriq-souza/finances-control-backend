---
id: '0022'
title: Rota de laboratório GET /hello
status: draft
depends_on: ['0005']
---

# 0022 — Rota de laboratório GET /hello

## Goal

Expor `GET /hello`, sem autenticação, que responde `200` com o corpo "hello world". A rota é fake e
não tem valor de produto: existe só para exercitar o fluxo spec → PR de spec → merge → implementação
(item de laboratório do FT Coders, tarefa 2.8).

## Scope / Non-goals

- **Em escopo:** a rota `GET /hello`, o teste dela e a entrada no `docs/openapi.yaml`.
- **Fora de escopo:**
    - autenticação, espaços (spec 0021) e qualquer dado de domínio;
    - parâmetros, persistência, eventos de domínio e jobs;
    - outros métodos em `/hello` (caem em `ROUTE_NOT_FOUND`, spec 0005);
    - mudar probes, ingress ou qualquer infraestrutura.

## Contracts

- **Rota:** `GET /hello`, pública (sem `security` no contrato, sem `authenticate` nem `requireProfile`).
- **Resposta `200`:** `Content-Type: application/json`, no mesmo formato de sucesso da plataforma
  (`HttpResponses.ok`, como `GET /health`):

    ```json
    { "data": { "message": "hello world" } }
    ```

    `data.message` é a string exata `hello world` (minúsculas, um espaço, sem pontuação).

- **Implementação:** módulo `hello` em `src/platform/hello/` (`HelloRoutes`, `HelloController`),
  montado em `/hello` no `src/api.config.ts`, seguindo o padrão de `src/platform/health/`. Os
  símbolos novos ficam em `src/platform/symbols/index.ts`.
- **Contrato OpenAPI:** operação `getHello` (tag `Platform`) em `/hello`, com a resposta `200`, o
  cabeçalho `x-correlation-id` e o exemplo acima. O `tests/openapi.spec.ts` exige que as rotas
  publicadas batam com os `paths`.
- **Suíte de isolamento:** `GET /hello` entra como `exempt` em `tests/integration/isolation/routes.spec.ts`
  (sem autenticação nem dados de domínio), como `GET /health`.

## Invariants

- **INV-0022-01:** `GET /hello` não exige credencial: a resposta é a mesma com e sem `Authorization`.
- **INV-0022-02:** a resposta não depende de banco, relógio nem estado: duas chamadas devolvem corpos idênticos.

## Error cases

| Situação                                  | Comportamento exigido                                      |
| ----------------------------------------- | ---------------------------------------------------------- |
| **ERR-0022-01** Método diferente de `GET` | `404`, `ROUTE_NOT_FOUND`, em JSON (spec 0005, ERR-0005-03) |

## Acceptance criteria

- **AC-0022-01:** `GET /hello` sem `Authorization` responde `200` com corpo `{ "data": { "message": "hello world" } }`.
- **AC-0022-02:** a resposta tem `Content-Type` JSON e o cabeçalho `x-correlation-id`.
- **AC-0022-03:** `POST /hello` responde `404` com `code` `ROUTE_NOT_FOUND`.
- **AC-0022-04:** o `docs/openapi.yaml` descreve `GET /hello` sem `security`, e o `tests/openapi.spec.ts` passa.

## Test mapping

| Item                                | Teste                                           |
| ----------------------------------- | ----------------------------------------------- |
| AC-0022-01, AC-0022-02, INV-0022-01 | `tests/platform/hello/hello.routes.spec.ts`     |
| INV-0022-02                         | `tests/platform/hello/hello.controller.spec.ts` |
| AC-0022-03, ERR-0022-01             | `tests/platform/hello/hello.routes.spec.ts`     |
| AC-0022-04                          | `tests/openapi.spec.ts`                         |

## Open questions

- O "corpo hello world" é o envelope JSON `{ "data": { "message": "hello world" } }` (proposto, igual
  ao resto da API) ou o texto puro `hello world` com `text/plain`? Quem aprova a spec decide.
