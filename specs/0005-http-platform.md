---
id: '0005'
title: Plataforma HTTP — erros de protocolo, contrato de erros e publicação sob /api
status: draft
depends_on: ['0002', '0003', '0010', '0017']
---

# 0005 — Plataforma HTTP

## Goal

Preparar a API para ser consumida pelo frontend da Fase 3
([ADR-0001](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0001-frontend.md)).
Ao final:

- toda resposta de erro chega como JSON no envelope da plataforma, inclusive as falhas de
  protocolo que hoje escapam do handler global;
- o `docs/openapi.yaml` enumera cada código de erro que o cliente pode receber, que é a base do
  catálogo de mensagens do frontend e do cliente gerado;
- a API fica publicada sob `/api`, no mesmo host do frontend, sem que as rotas do backend mudem.

## Scope / Non-goals

- **Em escopo:**
    - os erros de corpo do `express.json()` e a resposta para rota inexistente;
    - o enum `ErrorCode` e o schema `ValidationError` no contrato;
    - `401` e `403` declarados em toda operação que os devolve;
    - a correção do `ReadinessReport`;
    - a publicação sob `/api` por `stripPrefix` do Traefik, decidida pelo responsável em 2026-10-10
      (opção A do levantamento da Fase 3);
    - `servers` do contrato, a collection do Postman e o redirect do Swagger para o prefixo.
- **Fora de escopo:**
    - **Mover as rotas do backend para `/api`.** O prefixo existe só no ingress (INV-0005-04).
    - **Retirar a regra `/` do ingress do backend.** Ela continua até o frontend ocupar `/`, e a
      troca é tarefa do repositório do frontend, na sua publicação.
    - **Traduzir mensagens.** Elas seguem em inglês, e o frontend traduz pelo `code`.
    - CORS, que não é necessário porque frontend e API ficam na mesma origem.
    - Paginação, rate limit e cabeçalhos de segurança (helmet).
    - Produção (Fase 4).

## Contracts

### Erros de protocolo

O handler global (`src/platform/middlewares/error-handler.middleware.ts`) passa a reconhecer os
erros do `express.json()` pelo campo `type` que o body-parser põe no erro, antes do ramo de erro não
tratado:

| Situação                                                        | Status | `code`              | Mensagem                         |
| --------------------------------------------------------------- | ------ | ------------------- | -------------------------------- |
| `type === 'entity.parse.failed'` (JSON malformado)              | `400`  | `INVALID_JSON`      | `Request body is not valid JSON` |
| `type === 'entity.too.large'` (acima do limite padrão de 100kb) | `413`  | `PAYLOAD_TOO_LARGE` | `Request body is too large`      |

- Uma rota sem handler, ou um método não registrado numa rota existente, responde `404`, código
  `ROUTE_NOT_FOUND`, mensagem `Route not found`.
- Quem responde é um middleware catch-all em `src/app.ts`. Ele é registrado depois de
  `registerApiModules` e antes dos error handlers, e entrega o erro ao handler global, que continua
  sendo o único lugar que escreve resposta de erro.
- O limite do `express.json()` continua o padrão. Esta spec só dá forma ao erro.

### Contrato de erros no `docs/openapi.yaml`

- **`ErrorCode`:** schema `string` com `enum` de todos os códigos que a aplicação emite.
    - Os códigos vêm das três fontes:
        - os literais passados a `CustomError` em `src/`, tanto em `new CustomError(<status>, '<CODE>', …)`
          quanto nas fábricas `CustomError.<fábrica>(<mensagem>, '<CODE>', …)`;
        - os erros de identidade da spec 0010;
        - os da plataforma: `VALIDATION_ERROR`, `INTERNAL_ERROR`, `NOT_READY` e os três desta spec.
    - O schema `Error` passa a ter `error.code` obrigatório, com `$ref` para `ErrorCode`.
- **`ValidationError`:** é o `Error` com `code` igual a `VALIDATION_ERROR` e `details` como lista de
  `ValidationIssue`.
    - `ValidationIssue = { path: (string | integer)[], code: string, message: string }` é o
      subconjunto estável das issues do zod.
    - Outros campos da issue podem vir (`additionalProperties: true`), mas o cliente só conta com
      esses três.
- **Respostas reutilizáveis** em `components.responses`, que as operações referenciam por `$ref`:

    | Resposta           | Status | Corpo             | Códigos possíveis                  |
    | ------------------ | ------ | ----------------- | ---------------------------------- |
    | `ValidationFailed` | `400`  | `ValidationError` | `VALIDATION_ERROR`, `INVALID_JSON` |
    | `Unauthenticated`  | `401`  | `Error`           | `UNAUTHENTICATED`, `TOKEN_EXPIRED` |
    | `Forbidden`        | `403`  | `Error`           | `PROFILE_PENDING`, `FORBIDDEN`     |

- **Quem declara o quê:**
    - toda operação com `security` declara `401`;
    - toda operação guardada por `requireProfile` declara `403`;
    - `GET /users/me` declara só `401` (INV-0010-03).
    - Hoje faltam essas respostas em operações de bancos, contas e cartões, por exemplo em
      `updateBank` e em `archiveBank`/`unarchiveBank`.
- **`ReadinessReport`:** ganha `checks.jobs`, com `enum` `up`, `down` e `disabled`, como a spec
  0017 (_Readiness_) já define e o código já devolve.

### Publicação sob `/api`

- **No `homelab-gitops`:** dois objetos novos em
  `clusters/homelab/workloads/dev/manifests/finances-backend/`, registrados no `kustomization.yaml`:
    - `Middleware` (`traefik.io/v1alpha1`) `finances-backend-strip-api`, com `stripPrefix.prefixes: ['/api']`;
    - `Ingress` `finances-backend-api`, com host `finances.dev.homelab.local`, path `/api` `Prefix` para o
      service `finances-backend:80`, `ingressClassName: traefik` e a anotação
      `traefik.ingress.kubernetes.io/router.middlewares: dev-apps-finances-backend-strip-api@kubernetescrd`.
- **O ingress atual** (path `/`) fica como está até o frontend ocupar `/`.
- **As probes** continuam em `/health` e `/health/ready`, direto no pod.
- **`servers` do contrato:** `http://localhost:3000` (Local) e `http://finances.dev.homelab.local/api` (Dev).
    - Os `paths` não mudam. O `tests/openapi.spec.ts` continua comparando as rotas publicadas com
      eles.
- **Postman:** o ambiente `dev` de `scripts/postman.mjs` (`ENVIRONMENTS`) passa a
  `http://finances.dev.homelab.local/api`, e a collection é regenerada por `npm run postman`.
- **Swagger:** a UI em `/docs/` já usa caminhos relativos e funciona atrás do `stripPrefix`. O que
  quebra é o redirect `301` de `/docs` para `/docs/`, que sai absoluto e perde o `/api`.
    - Um middleware antes do Swagger, em `src/app.ts`, responde `/docs` (sem barra) com `301` para
      `${prefixo}/docs/`.
    - `prefixo` é o valor de `X-Forwarded-Prefix`, que o `stripPrefix` do Traefik acrescenta, quando
      ele for exatamente `/api`. Em qualquer outro caso, o prefixo é vazio.

## Invariants

- **INV-0005-01:** toda resposta de erro da API é JSON no envelope `{ error: { message, code, details? } }`,
  com `code` presente; o HTML padrão do Express nunca chega ao cliente. A UI do Swagger é página,
  não resposta de API, e fica fora desta regra.
- **INV-0005-02:** o `enum` de `ErrorCode` é exatamente o conjunto de códigos que a aplicação emite.
  Não pode haver código emitido fora do enum nem código no enum que ninguém emite.
- **INV-0005-03:** toda operação com `security` declara `401`, e toda operação guardada por
  `requireProfile` declara `403`.
- **INV-0005-04:** as rotas do backend não conhecem o prefixo `/api`. Ele só aparece:
    - no ingress;
    - em `servers` do contrato;
    - no ambiente `dev` do Postman;
    - no redirect do Swagger.
- **INV-0005-05:** o redirect do Swagger só aceita o prefixo `/api`. Qualquer outro
  `X-Forwarded-Prefix` é ignorado, o que impede usar o redirect para mandar o navegador a outro
  lugar.

## Error cases

| Situação                                                  | Comportamento exigido                                    |
| --------------------------------------------------------- | -------------------------------------------------------- |
| **ERR-0005-01** Corpo JSON malformado                     | `400`, `INVALID_JSON`, sem detalhe do parser na resposta |
| **ERR-0005-02** Corpo acima do limite do `express.json()` | `413`, `PAYLOAD_TOO_LARGE`                               |
| **ERR-0005-03** Rota ou método inexistente                | `404`, `ROUTE_NOT_FOUND`, em JSON                        |
| **ERR-0005-04** `X-Forwarded-Prefix` diferente de `/api`  | Ignorado: o redirect de `/docs` vai para `/docs/`        |

## Acceptance criteria

- **AC-0005-01:** `POST /banks` com `Content-Type: application/json` e corpo `{` responde `400`,
  com `code` `INVALID_JSON` no envelope JSON.
- **AC-0005-02:** um corpo JSON acima de 100kb responde `413`, com `code` `PAYLOAD_TOO_LARGE`.
- **AC-0005-03:** `GET /nao-existe` e `DELETE /health` respondem `404`, com `code` `ROUTE_NOT_FOUND`
  e `Content-Type` JSON.
- **AC-0005-04:** o teste de contrato reprova quando um código emitido em `src/` não está no
  `ErrorCode`, e quando o `ErrorCode` tem código que nenhuma fonte emite.
- **AC-0005-05:** o teste de contrato reprova uma operação com `security` sem `401`, e uma operação
  guardada por `requireProfile` sem `403`.
- **AC-0005-06:** um corpo inválido numa rota com zod responde `400 VALIDATION_ERROR`, e cada item
  de `details` tem `path` (lista), `code` e `message`.
- **AC-0005-07:** o `ReadinessReport` do contrato descreve `checks.jobs`, e a resposta real de
  `GET /health/ready` traz `jobs` com um dos três valores.
- **AC-0005-08:** o `servers` Dev do contrato é `http://finances.dev.homelab.local/api`, o ambiente
  `dev` do Postman usa a mesma URL, e o `tests/postman.spec.ts` passa com a collection regenerada.
- **AC-0005-09:** sobre o redirect de `GET /docs`:
    - com `X-Forwarded-Prefix: /api`, responde `301` com `Location: /api/docs/`;
    - sem o cabeçalho, ou com `X-Forwarded-Prefix: //example.com`, responde `301` com `Location: /docs/`.
- **AC-0005-10:** em `dev`:
    - `GET http://finances.dev.homelab.local/api/health` responde `200`;
    - `/api/docs` chega à UI do Swagger;
    - `GET http://finances.dev.homelab.local/health` continua respondendo, porque a regra `/` ainda
      existe.

    A evidência vai colada no PR da tarefa.

## Test mapping

| Item                                             | Teste                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| AC-0005-01, AC-0005-02, ERR-0005-01, ERR-0005-02 | `tests/platform/http/protocol-errors.spec.ts`                               |
| AC-0005-03, INV-0005-01, ERR-0005-03             | `tests/platform/http/protocol-errors.spec.ts`                               |
| AC-0005-04, AC-0005-05, INV-0005-02, INV-0005-03 | `tests/openapi.spec.ts`                                                     |
| AC-0005-06                                       | `tests/platform/http/protocol-errors.spec.ts`                               |
| AC-0005-07                                       | `tests/openapi.spec.ts` e `tests/integration/platform/health/ready.spec.ts` |
| AC-0005-08, INV-0005-04                          | `tests/postman.spec.ts` e `tests/openapi.spec.ts`                           |
| AC-0005-09, INV-0005-05, ERR-0005-04             | `tests/platform/http/docs-redirect.spec.ts`                                 |
| AC-0005-10                                       | evidência manual no PR (`curl` contra o ingress de `dev`)                   |

## Open questions

Nenhuma.
