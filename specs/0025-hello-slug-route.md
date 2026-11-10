---
id: '0025'
title: Rota de laboratório GET /hello/{name}/slug
status: implemented
depends_on: ['0005', '0023']
---

# 0025 — Rota de laboratório GET /hello/{name}/slug

## Goal

Acrescentar às rotas de laboratório hello uma rota pública, `GET /hello/{name}/slug`, que devolve o
nome em formato slug (`João da Silva` → `joao-da-silva`), calculado com o pacote npm `slugify`.
Continua sem valor de produto: é o item de laboratório do FT Coders (4.2) que exercita o
`npm install` de uma dependência nova com egress restrito.

## Scope / Non-goals

- **Em escopo:** a rota, o schema de nome próprio desta rota, a função de slug, a dependência
  `slugify` (com `package-lock.json` atualizado), o contrato no `docs/openapi.yaml`, a collection do
  Postman, a entrada na suíte de isolamento e os testes.
- **Fora de escopo:**
    - mudar `GET /hello`, `/hello/{name}`, `/upper` ou `/length` (specs 0022 a 0024);
    - alterar o `nameParamsSchema`, que segue inalterado e usado só pelas rotas existentes;
    - autenticação, espaços (spec 0021), persistência, eventos de domínio e jobs;
    - outros métodos na nova rota (caem em `ROUTE_NOT_FOUND`, spec 0005);
    - a spec 0028 citada no item não existe neste repositório e não é dependência: o "egress
      restrito" é só o contexto do laboratório e vira o requisito de instalação em INV-0025-04.

## Contracts

- **Regra do nome (`slugNameParamsSchema`, em `src/platform/hello/hello.schemas.ts`):** schema zod
  próprio desta rota, aplicado ao parâmetro já decodificado: `^(?=.*\p{L})[\p{L} -]{1,40}$` (flag `u`)
  — letras, espaço e hífen, de 1 a 40 caracteres, com ao menos uma letra. O nome vazio ou só com
  espaços (ou só hífens) é inválido. Além do padrão, o slug calculado não pode ser vazio (ERR-0025-02).
  Nome inválido responde `400` `VALIDATION_ERROR` com `path` igual a `["name"]`, como em 0023.
- **Função de slug (`toSlug(name: string): string`, em `src/platform/hello/hello.slug.ts`):**
  função pura que chama `slugify(name, { lower: true, strict: true, trim: true })`, sem `locale`
  (independe do ambiente). Exemplos: `João da Silva` → `joao-da-silva`; `Ana-Clara` → `ana-clara`;
  ` Maria   Souza` → `maria-souza`.
- **`GET /hello/{name}/slug`** — pública (sem `security`, `authenticate` nem `requireProfile`),
  `HelloController.handleGetHelloSlug`, operação OpenAPI `getHelloNameSlug` (tag `Platform`).
  `GET /hello/João da Silva/slug` é enviado com percent-encoding (`/hello/Jo%C3%A3o%20da%20Silva/slug`).
    - Resposta `200`, mesmo formato de `HttpResponses.ok`:

        ```json
        { "data": { "slug": "joao-da-silva" } }
        ```

- **Contrato OpenAPI:** path `/hello/{name}/slug`, parâmetro de path `name` (`type: string`,
  `minLength: 1`, `maxLength: 40`, `pattern: '^(?=.*\p{L})[\p{L} -]{1,40}$'`), resposta `200` com o
  cabeçalho `x-correlation-id` e o exemplo acima, e `400` por `$ref: ValidationFailed`. Sem `security`.
- **Dependência:** `slugify` em `dependencies` do `package.json`, versão exata `1.6.9` (sem `^`),
  instalada com `npm install --save-exact slugify@1.6.9` e `package-lock.json` atualizado no mesmo PR.
- **Postman:** collection gerada por `npm run postman` (não se edita à mão); `tests/postman.spec.ts`
  falha se ficar defasada.
- **Suíte de isolamento:** `GET /hello/:name/slug` entra como `exempt` em
  `tests/integration/isolation/routes.spec.ts`.

## Invariants

- **INV-0025-01:** a rota não exige credencial: a resposta é a mesma com e sem `Authorization`.
- **INV-0025-02:** a resposta depende só do `name`: sem banco, relógio, locale nem estado; duas chamadas com o mesmo nome devolvem corpos idênticos.
- **INV-0025-03:** o `pattern` e os limites do parâmetro `name` no contrato aceitam exatamente os nomes que o `slugNameParamsSchema` aceita; o `nameParamsSchema` não foi alterado.
- **INV-0025-04:** o `slugify` consta em `package.json` com versão exata e em `package-lock.json`, e `npm ci` a partir do lockfile o instala sem resolver nada novo.
- **INV-0025-05:** o `slug` devolvido casa com `^[a-z0-9]+(-[a-z0-9]+)*$`, nunca é vazio e nunca começa ou termina com `-`.

## Error cases

| Situação                                                                          | Comportamento exigido                                                            |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **ERR-0025-01** Nome só com espaços (`%20`), só com hífens, ou com 41+ caracteres | `400`, `VALIDATION_ERROR`, `details[0].path = ["name"]`                          |
| **ERR-0025-02** Nome válido pelo padrão cujo slug sai vazio (ex.: `日本語`)       | `400`, `VALIDATION_ERROR`, `details[0].path = ["name"]`                          |
| **ERR-0025-03** Nome com dígito, `_`, ponto, `@` etc.                             | `400`, `VALIDATION_ERROR`                                                        |
| **ERR-0025-04** Percent-encoding malformado (ex.: `/hello/%E0%A4%A/slug`)         | `400`, `VALIDATION_ERROR`, sem detalhe do decodificador                          |
| **ERR-0025-05** Método diferente de `GET`                                         | `404`, `ROUTE_NOT_FOUND`, em JSON (spec 0005, ERR-0005-03)                       |
| **ERR-0025-06** `/hello//slug` (nome vazio)                                       | Não casa `/:name/slug`: segue o tratamento da spec 0005 (não é `400` desta rota) |

## Acceptance criteria

- **AC-0025-01:** `GET /hello/Jo%C3%A3o%20da%20Silva/slug` sem `Authorization` responde `200` com `{ "data": { "slug": "joao-da-silva" } }`, `Content-Type` JSON e o cabeçalho `x-correlation-id`.
- **AC-0025-02:** `GET /hello/Maria/slug` responde `maria`; `/hello/Ana-Clara/slug` responde `ana-clara`; `/hello/%20Maria%20%20Souza%20/slug` responde `maria-souza`.
- **AC-0025-03:** um nome de 40 letras é aceito; um de 41 responde `400 VALIDATION_ERROR` (ERR-0025-01).
- **AC-0025-04:** `GET /hello/%20/slug`, `/hello/%20%20%20/slug` e `/hello/-/slug` respondem `400 VALIDATION_ERROR` (ERR-0025-01), cada item de `details` com `path`, `code` e `message`.
- **AC-0025-05:** `GET /hello/Ana2/slug`, `/hello/Ana_/slug` e `/hello/%E6%97%A5%E6%9C%AC%E8%AA%9E/slug` respondem `400 VALIDATION_ERROR` (ERR-0025-02, ERR-0025-03); percent-encoding malformado também (ERR-0025-04).
- **AC-0025-06:** `POST /hello/Maria/slug` responde `404 ROUTE_NOT_FOUND` (ERR-0025-05); `GET /hello/%20/slug` não é confundido com `/hello//slug` (ERR-0025-06).
- **AC-0025-07:** `toSlug` devolve os exemplos do contrato e satisfaz INV-0025-05 para entradas variadas (acentos, espaços repetidos, hífens nas pontas).
- **AC-0025-08:** o `docs/openapi.yaml` descreve `GET /hello/{name}/slug` sem `security`, com `200` e `400` (`ValidationFailed`), e o `tests/openapi.spec.ts` passa.
- **AC-0025-09:** a collection do Postman foi regenerada com `getHelloNameSlug` e o `tests/postman.spec.ts` passa; a suíte de isolamento classifica a rota como `exempt`.
- **AC-0025-10:** `slugify@1.6.9` está em `package.json` (versão exata) e `package-lock.json`; `npm ci` e `npm audit` (gate) passam.

## Test mapping

| Item                                                            | Teste                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| AC-0025-01 a AC-0025-06, ERR-0025-01 a ERR-0025-06, INV-0025-01 | `tests/platform/hello/hello.routes.spec.ts`                                                   |
| AC-0025-07, INV-0025-02, INV-0025-05                            | `tests/platform/hello/hello.slug.spec.ts`                                                     |
| INV-0025-02                                                     | `tests/platform/hello/hello.controller.spec.ts`                                               |
| INV-0025-03, AC-0025-08                                         | `tests/openapi.spec.ts`                                                                       |
| AC-0025-09                                                      | `tests/postman.spec.ts`, `tests/integration/isolation/routes.spec.ts`                         |
| INV-0025-04, AC-0025-10                                         | `tests/platform/hello/hello.slug.spec.ts` (lê `package.json`), gate de auditoria da spec 0002 |

## Decisions

- **Schema próprio, `nameParamsSchema` intacto:** o critério pede nomes com espaço, que o
  `nameParamsSchema` rejeita (spec 0024 o declara inalterável). Descartado: relaxar o schema
  compartilhado, que mudaria as rotas 0023 e 0024.
- **Envelope `data`:** a resposta segue `HttpResponses.ok` (`{ "data": { "slug": ... } }`), como todas as rotas hello, e não o corpo literal `{ "slug": ... }` do item. Descartado: corpo sem envelope, que quebraria o padrão da plataforma.
- **Dígitos continuam inválidos:** mantém a regra de letras do laboratório; só o espaço é acrescentado.
- **Nome vazio / só espaços:** `/hello//slug` não casa a rota (não há segmento), então o caso testável é `%20`, que vira `400`. Slug vazio após a conversão (alfabetos que o `slugify` não transliterar, com `strict`) também vira `400` em vez de `200` com slug vazio.
- **Opções do `slugify`:** `lower`, `strict` e `trim`, sem `locale`, para resultado independente do ambiente (INV-0025-02). Descartado: `locale` fixo, desnecessário para o português.
- **Versão exata:** para que o laboratório de egress restrito instale o mesmo artefato do lockfile (`npm ci`).
- **Uma tarefa só:** o gate exige rota, contrato, Postman e isolamento juntos, e a dependência só é usada pela rota; dividir deixaria o gate vermelho ou a dependência sem uso.

## Open questions

Nenhuma.
