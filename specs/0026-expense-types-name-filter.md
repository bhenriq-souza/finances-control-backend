---
id: '0026'
title: Filtro por nome em GET /expense-types
status: draft
depends_on: ['0005', '0012']
---

# 0026 — Filtro por nome em GET /expense-types

## Goal

Permitir que `GET /expense-types` aceite o parâmetro opcional `name` e devolva só os tipos de
despesa cujo nome **contém** o termo, sem diferenciar maiúsculas, minúsculas nem acentos
(`alim` e `ALIMENTAÇÃO` encontram `Alimentação`). Com muitos tipos cadastrados, achar um deles
na listagem inteira fica difícil. Sem o parâmetro, a listagem não muda.

## Scope / Non-goals

- **Em escopo:** o parâmetro `name` na rota, o schema de query próprio de `/expense-types`, a
  função de normalização e o filtro no `ExpenseTypeService.list`, o contrato em
  `docs/openapi.yaml`, a collection do Postman e os testes.
- **Fora de escopo:**
    - paginação, ordenação (segue por nome ascendente) e filtros em outros recursos;
    - alterar o `listQuerySchema` da plataforma, usado por contas, cartões e outras listagens;
    - alterar `expense_types`, índices, extensões do Postgres ou migrations;
    - mudar o `uq_expense_types_name` ou a regra de unicidade de nome (spec 0012, ERR-0012-01).

## Contracts

- **Query de `GET /expense-types`** (`listExpenseTypesQuerySchema`, em
  `src/expenses/expense-type.schemas.ts`): `listQuerySchema.extend({ name })`, ainda `strict()`.
  `name` é `string` opcional; depois de `trim`, tem de 0 a 120 caracteres (o mesmo máximo do nome
  do tipo). `name` repetido na query (`?name=a&name=b`) é inválido.
- **Termo vazio:** `name` vazio ou só com espaços equivale a **não informar** o parâmetro
  (nenhum filtro por nome).
- **Normalização (`normalizeSearchText(value: string): string`, em
  `src/expenses/expense-type.search.ts`):** função pura: `trim`, `normalize('NFD')`, remoção dos
  caracteres da categoria Unicode `\p{M}` (acentos) e `toLowerCase()`.
  `Ação` → `acao`; ` CAFÉ` → `cafe`.
- **Filtro:** um tipo casa quando `normalizeSearchText(type.name)` **contém**
  `normalizeSearchText(name)` como substring. Os caracteres `%`, `_` e `\` são literais: não há
  `LIKE`, então não são curingas.
- **Combinação com `archived`:** os dois filtros se somam (E). Sem `archived=true` só aparecem
  tipos não arquivados que casam com `name`; com `archived=true`, arquivados e não arquivados
  que casam.
- **Resposta:** inalterada (`200`, `{ "data": ExpenseTypeResponse[] }`, ordenada por `name`
  ascendente). Nenhum casamento devolve `200` com `data: []`.
- **Autorização:** inalterada (qualquer perfil, spec 0012).
- **Contrato OpenAPI:** a operação `listExpenseTypes` ganha o parâmetro de query `name`
  (`type: string`, `maxLength: 120`, opcional, descrição do "contém" sem acentos nem caixa); o
  `400 ValidationFailed` já existe. O parâmetro `archived` não muda.
- **Postman:** collection regenerada por `npm run postman` (não se edita à mão);
  `tests/postman.spec.ts` falha se ficar defasada.

## Invariants

- **INV-0026-01:** sem `name` (ou com `name` vazio ou só com espaços), a resposta é idêntica à de antes desta spec, para qualquer valor de `archived`.
- **INV-0026-02:** o casamento não depende de maiúsculas, minúsculas nem acentos, nem do termo nem do nome armazenado.
- **INV-0026-03:** `%`, `_` e `\` no termo casam só a si mesmos.
- **INV-0026-04:** o filtro nunca revela tipo arquivado sem `archived=true` e não altera a ordenação.
- **INV-0026-05:** nenhuma migration nem extensão de banco é necessária: o filtro vive na aplicação.

## Error cases

| Situação                                                         | Comportamento exigido                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **ERR-0026-01** `name` com mais de 120 caracteres (após `trim`)  | `400`, `VALIDATION_ERROR`, `details[0].path = ["name"]`                  |
| **ERR-0026-02** `name` repetido na query                         | `400`, `VALIDATION_ERROR`, `details[0].path = ["name"]`                  |
| **ERR-0026-03** Parâmetro desconhecido na query (ex.: `?nome=x`) | `400`, `VALIDATION_ERROR` (comportamento atual do `strict()` preservado) |

## Acceptance criteria

- **AC-0026-01:** com os tipos `Alimentação`, `Transporte` e `Lazer`, `GET /expense-types?name=alim` devolve só `Alimentação`.
- **AC-0026-02:** `?name=ALIMENTACAO`, `?name=alimentação` e `?name=ALIMENTAÇÃO` devolvem o mesmo resultado, e `?name=ment` (meio do nome) também casa.
- **AC-0026-03:** sem `name`, a listagem devolve todos os tipos não arquivados, ordenados por nome, como antes; `?name=` e `?name=%20%20` fazem o mesmo (INV-0026-01).
- **AC-0026-04:** com um tipo arquivado que casa, `?name=...` não o devolve; `?name=...&archived=true` o devolve junto com os não arquivados que casam, em ordem de nome.
- **AC-0026-05:** `?name=%25` e `?name=_` devolvem `data: []` (nenhum nome contém esses caracteres) e, com um tipo chamado `100% Lazer`, `?name=%25` devolve só ele.
- **AC-0026-06:** um termo sem casamento devolve `200` com `data: []`.
- **AC-0026-07:** `name` com 121 caracteres e `name` repetido respondem `400 VALIDATION_ERROR` com `path = ["name"]`; um termo de 120 caracteres é aceito; `?nome=x` segue `400`.
- **AC-0026-08:** `normalizeSearchText` devolve os exemplos do contrato e é idempotente.
- **AC-0026-09:** o `docs/openapi.yaml` descreve o parâmetro `name` em `GET /expense-types` e o `tests/openapi.spec.ts` passa.
- **AC-0026-10:** a collection do Postman foi regenerada com o parâmetro e o `tests/postman.spec.ts` passa; a suíte de isolamento continua classificando a rota como `exempt`.

## Test mapping

| Item                                                                                      | Teste                                                                                            |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| AC-0026-01 a AC-0026-06, INV-0026-01 a INV-0026-04, ERR-0026-01 a ERR-0026-03, AC-0026-07 | `tests/integration/expenses/expense-types.spec.ts`                                               |
| AC-0026-08, INV-0026-02, INV-0026-03                                                      | `tests/expenses/expense-type.search.spec.ts`                                                     |
| INV-0026-05                                                                               | `tests/integration/platform/database/migrations.spec.ts` (nenhuma migration nova; revisão em PR) |
| AC-0026-09                                                                                | `tests/openapi.spec.ts`                                                                          |
| AC-0026-10                                                                                | `tests/postman.spec.ts`, `tests/integration/isolation/routes.spec.ts`                            |

## Decisions

- **Normalização na aplicação, sem `unaccent`:** o catálogo de tipos é global e pequeno (dezenas
  de linhas) e a listagem não é paginada; filtrar em memória após a consulta atual não custa
  nada mensurável e evita extensão, migration, ADR e privilégio de `CREATE EXTENSION` no banco
  gerenciado. Descartado: `unaccent` com `ILIKE` (precisa de extensão e de função `IMMUTABLE`
  para qualquer índice). Se o catálogo crescer a ponto de pesar, uma nova spec move o filtro para
  o banco.
- **Sem `LIKE`, sem escape:** como o casamento é por substring em memória, `%` e `_` são
  literais por construção; não há escape a errar.
- **`name` vazio equivale a ausente:** um campo de busca limpo costuma enviar `?name=`; tratar
  como erro obrigaria o frontend a remover o parâmetro. Descartado: `400` para termo vazio.
- **Limite de 120:** igual ao máximo do nome do tipo; um termo maior nunca casaria.
- **Schema próprio:** `listQuerySchema` é compartilhado com contas e cartões; estendê-lo ali
  criaria o parâmetro onde ele não faz sentido.
- **Uma tarefa só:** o gate exige rota, contrato OpenAPI e Postman juntos (`tests/openapi.spec.ts`,
  `tests/postman.spec.ts`); dividir deixaria o gate vermelho.

## Open questions

Nenhuma.
