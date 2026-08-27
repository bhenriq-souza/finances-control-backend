---
id: "0002"
title: Portões de qualidade e orquestrador único
status: approved
depends_on: ["0000", "0001"]
---

# 0002 — Portões de Qualidade

## Goal

Definir os portões de qualidade do repositório e o **orquestrador único** que os executa, de modo que o mesmo comando rode localmente e no CI, que nenhum gate exista apenas em um dos dois lados, e que a ausência de uma ferramenta seja sempre visível em vez de silenciosamente transformar o pipeline em verde.

## Scope / Non-goals

- **Em escopo:** lista de gates, o orquestrador `scripts/check.mjs`, semântica de PASS/FAIL/SKIP, modo estrito do CI, política de alteração de gates.
- **Fora de escopo:** conteúdo dos testes de domínio (specs 0010+); o pipeline de build e publicação de imagem, que é assunto do reusable workflow do homelab.

## Contracts

### Gates

| Gate | Comando | Verifica |
|---|---|---|
| `format` | `npx prettier --check .` | formatação |
| `lint` | `npx eslint .` | regras de lint |
| `types` | `npx tsc --noEmit` | tipagem |
| `boundaries` | `npx depcruise src` | fronteiras de módulo (ADR-0003, regras 1–3) |
| `test` | `npx jest --coverage` | testes e cobertura mínima |
| `audit` | `npm audit --audit-level=high --omit=dev` | vulnerabilidades em dependências de runtime |
| `specs` | `node scripts/check-specs.mjs` | estrutura das specs e do backlog (spec 0000) |

O gate `boundaries` é o enforcement automatizado das regras de fronteira do ADR-0003; sua configuração declara quais módulos podem depender de quais, com `reporting` autorizado a ler múltiplos contextos e `platform` acessível a todos.

### Orquestrador único

`scripts/check.mjs`, exposto como `npm run check`, é a **única** forma de executar o conjunto. Ele:

1. Executa todos os gates **sequencialmente e até o fim** — não para no primeiro erro, para que uma rodada revele todas as falhas.
2. Classifica cada gate como:
   - **PASS** — executou e passou;
   - **FAIL** — executou e falhou;
   - **SKIP (contexto)** — a ferramenta ainda não existe no repositório nesta fase (ex.: antes do scaffold);
   - **SKIP (ambiente)** — a ferramenta é opcional e não está instalada no ambiente atual.
3. Imprime uma tabela final com o estado de cada gate e o motivo de cada SKIP.
4. Sai com código diferente de zero se houver qualquer FAIL.
5. Com `--require-tools`, converte **todo SKIP em FAIL**. O CI sempre usa esta flag a partir da conclusão do scaffold (T-0002-03).

O modo estrito existe porque um ambiente sem as ferramentas instaladas produziria um pipeline verde com metade dos gates ausentes, e ninguém perceberia.

### Política de alteração

- Nunca afrouxar a configuração de um gate para fazer uma tarefa passar.
- Supressões pontuais são explícitas, justificadas em comentário no próprio ponto e, quando protegem um comportamento, fixadas por teste.
- Alterar a lista de gates, seus comandos ou seus limiares exige alterar **esta spec** no PR que faz a alteração.

## Invariants

- **INV-0002-01:** todo gate da tabela é executado por `npm run check`.
- **INV-0002-02:** um gate ausente aparece como SKIP com motivo, nunca como PASS.
- **INV-0002-03:** o CI invoca o orquestrador e não reimplementa nenhum gate.
- **INV-0002-04:** `npm run check` sai com código diferente de zero se qualquer gate falhar.
- **INV-0002-05:** no CI, nenhum gate é pulado (`--require-tools` ativo).

## Error cases

| Situação | Comportamento exigido |
|---|---|
| Ferramenta não instalada, modo normal | SKIP (ambiente ou contexto), com motivo na tabela; código de saída não é afetado |
| Ferramenta não instalada, `--require-tools` | FAIL, com mensagem indicando qual ferramenta falta |
| Gate falha | registrar a falha, seguir para os demais, reportar tudo ao final e sair com código 1 |
| Script de gate inexistente | tratado como SKIP (contexto), citando o caminho esperado |

## Acceptance criteria

- **AC-0002-01:** `npm run check` executa todos os gates disponíveis e imprime tabela final com estado e motivo.
- **AC-0002-02:** `npm run check` sai com código 1 quando ao menos um gate falha, e 0 quando não há falha.
- **AC-0002-03:** `npm run check -- --require-tools` sai com código 1 se qualquer gate for pulado.
- **AC-0002-04:** `.github/workflows/ci.yml` executa o orquestrador com `--require-tools` e nenhum outro comando de verificação.

## Test mapping

| Item | Teste |
|---|---|
| AC-0002-01, AC-0002-02, INV-0002-01, INV-0002-02, INV-0002-04 | execução manual documentada no PR do seed; testes de unidade do orquestrador em T-0002-01 |
| AC-0002-03, INV-0002-05 | execução do modo estrito no CI |
| AC-0002-04, INV-0002-03 | inspeção de `.github/workflows/ci.yml` em revisão de PR |

## Open questions

Nenhuma.
