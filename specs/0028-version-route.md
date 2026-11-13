---
id: '0028'
title: Rota GET /version
status: draft
depends_on: ['0003', '0005']
---

# 0028 — Rota GET /version

## Goal

Expor `GET /version`, pública, que devolve a versão da API em execução. Serve a quem opera ou
integra (frontend, smoke de deploy) e precisa saber qual build responde, sem ter de ler o relatório
completo de `GET /health`.

## Scope / Non-goals

- **Em escopo:** a rota `GET /version`, o teste dela, a entrada no `docs/openapi.yaml`, a collection
  do Postman e a entrada na suíte de isolamento.
- **Fora de escopo:**
    - SHA do commit ou da imagem: não há hoje variável de ambiente para isso e o pipeline de build
      não está definido aqui (ver Decisions);
    - autenticação, espaços (spec 0021), persistência, eventos de domínio e jobs;
    - mudar `GET /health` (spec 0003) ou o valor de `APPLICATION_VERSION`;
    - ler `package.json` ou qualquer arquivo em tempo de execução;
    - outros métodos em `/version` (caem em `ROUTE_NOT_FOUND`, spec 0005).

## Contracts

- **Rota:** `GET /version`, pública (sem `security` no contrato, sem `authenticate` nem `requireProfile`).
  Como as demais rotas, o backend a serve na raiz e o prefixo `/api` existe só no ingress (INV-0005-04).
- **Origem do valor:** `IEnvService.getEnv('APPLICATION_VERSION')`, a mesma variável que `GET /health`
  já expõe em `version`. Não há configuração nova.
- **Resposta `200`:** `Content-Type: application/json`, via `HttpResponses.ok`:

    ```json
    { "data": { "version": "0.0.0" } }
    ```

    `data.version` é exatamente o valor de `APPLICATION_VERSION`, sem transformação.

- **Implementação:** módulo `version` em `src/platform/version/` (`VersionRoutes`, `VersionController`),
  montado em `/version` em `src/api.config.ts`, no padrão de `src/platform/health/`. O controller
  injeta `EnvServiceSymbol`. Símbolos novos em `src/platform/symbols/index.ts`.
- **Contrato OpenAPI:** operação `getVersion` (tag `Platform`) em `/version`, com resposta `200`, o
  cabeçalho `x-correlation-id` e o exemplo acima, sem `security`.
- **Postman:** collection regenerada por `npm run postman` (não se edita à mão).
- **Suíte de isolamento:** `GET /version` entra como `exempt` em `tests/integration/isolation/routes.spec.ts`.

## Invariants

- **INV-0028-01:** a rota não exige credencial: a resposta é a mesma com e sem `Authorization`.
- **INV-0028-02:** a resposta não depende de banco, relógio nem arquivo: só do valor de `APPLICATION_VERSION`; duas chamadas devolvem corpos idênticos.
- **INV-0028-03:** `data.version` de `GET /version` é igual a `version` de `GET /health` para a mesma configuração.

## Error cases

| Situação                                  | Comportamento exigido                                      |
| ----------------------------------------- | ---------------------------------------------------------- |
| **ERR-0028-01** Método diferente de `GET` | `404`, `ROUTE_NOT_FOUND`, em JSON (spec 0005, ERR-0005-03) |

`APPLICATION_VERSION` ausente não é caso da rota: a variável é `required` e a aplicação não sobe sem ela.

## Acceptance criteria

- **AC-0028-01:** `GET /version` sem `Authorization` responde `200` com `{ "data": { "version": <APPLICATION_VERSION> } }`.
- **AC-0028-02:** a resposta tem `Content-Type` JSON e o cabeçalho `x-correlation-id`.
- **AC-0028-03:** `POST /version` responde `404` com `code` `ROUTE_NOT_FOUND`.
- **AC-0028-04:** o `docs/openapi.yaml` descreve `GET /version` sem `security`, e o `tests/openapi.spec.ts` passa.
- **AC-0028-05:** a collection do Postman inclui `getVersion` e o `tests/postman.spec.ts` passa; a suíte de isolamento classifica a rota como `exempt`.

## Test mapping

| Item                                | Teste                                                                 |
| ----------------------------------- | --------------------------------------------------------------------- |
| AC-0028-01, AC-0028-02, INV-0028-01 | `tests/platform/version/version.routes.spec.ts`                       |
| AC-0028-03, ERR-0028-01             | `tests/platform/version/version.routes.spec.ts`                       |
| INV-0028-02, INV-0028-03            | `tests/platform/version/version.controller.spec.ts`                   |
| AC-0028-04                          | `tests/openapi.spec.ts`                                               |
| AC-0028-05                          | `tests/postman.spec.ts`, `tests/integration/isolation/routes.spec.ts` |

## Decisions

- **Origem = `APPLICATION_VERSION`:** reaproveita a variável que `/health` já expõe, sem leitura de arquivo em runtime nem configuração nova; mantém as duas rotas coerentes (INV-0028-03). Descartado: ler `version` do `package.json` (I/O em runtime, e hoje é `0.0.0`) e SHA de commit/imagem (exigiria mudar o build, fora do escopo; pode virar spec própria).
- **Envelope `data`:** segue `HttpResponses.ok`, como `/health` e `/hello`. Descartado: corpo sem envelope.
- **Pública:** como `/health` e `/hello`; a versão não é dado sensível de domínio. Descartado: proteger com autenticação, que impediria smoke de deploy.
- **Fora de `/api` no código:** o backend serve na raiz e o ingress acrescenta `/api` (spec 0005); não há prefixo próprio.
- **Módulo próprio em `platform/version`:** em vez de novo método em `health`, para manter liveness/readiness separados (INV-0003-06).
- **Uma tarefa só:** o gate exige rota, contrato, Postman e isolamento juntos; dividir deixaria o gate vermelho.

## Open questions

Nenhuma.
