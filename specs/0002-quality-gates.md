---
id: '0002'
title: Portões de qualidade e orquestrador único
status: approved
depends_on: ['0000', '0001']
---

# 0002 — Portões de Qualidade

## Goal

Definir os portões de qualidade do repositório e o **orquestrador único** que os executa, de modo que o mesmo comando rode localmente e no CI, que nenhum gate exista apenas em um dos dois lados, e que a ausência de uma ferramenta seja sempre visível em vez de silenciosamente transformar o pipeline em verde.

## Scope / Non-goals

- **Em escopo:** lista de gates, o orquestrador `scripts/check.mjs`, semântica de PASS/FAIL/SKIP, modo estrito do CI, política de alteração de gates e a análise de segurança do código (o gate `sast` e o CodeQL complementar).
- **Fora de escopo:** conteúdo dos testes de domínio (specs 0010+); o pipeline de build e publicação de imagem, que é assunto do reusable workflow do homelab.

## Contracts

### Gates

| Gate         | Comando                                   | Verifica                                     |
| ------------ | ----------------------------------------- | -------------------------------------------- |
| `format`     | `npx prettier --check .`                  | formatação                                   |
| `lint`       | `npx eslint .`                            | regras de lint                               |
| `types`      | `npx tsc --noEmit`                        | tipagem                                      |
| `boundaries` | `npx depcruise src`                       | fronteiras de módulo (ADR-0003, regras 1–3)  |
| `test`       | `npx jest --coverage`                     | testes e cobertura mínima                    |
| `audit`      | `npm audit --audit-level=high --omit=dev` | vulnerabilidades em dependências de runtime  |
| `specs`      | `node scripts/check-specs.mjs`            | estrutura das specs e do backlog (spec 0000) |
| `sast`       | `node scripts/sast.mjs`                   | vulnerabilidades no código (Semgrep CE)      |

Cópias de trabalho de agentes em `.claude/worktrees/` ficam fora dos gates `format` e `lint` (ignoradas pelo Git, pelo Prettier e pelo ESLint): não são código deste working tree, e sim de outras branches ([execução paralela](../docs/parallel-execution.md)).

O gate `boundaries` é o enforcement automatizado das regras de fronteira do ADR-0003; sua configuração declara quais módulos podem depender de quais, com `reporting` autorizado a ler múltiplos contextos e `platform` acessível a todos. As únicas outras dependências entre módulos de domínio permitidas são `expenses`, `statements` e `earnings` → `src/accounts/index.ts` (regra `only-accounts-public-api-across-domain`): invariante financeira entre módulos é chamada síncrona à interface pública do dono do número (ADR-0003, regra 4; INV-0004-03; specs 0012, 0013 e 0014); e `statements` → `src/expenses/index.ts` (regra `statements-reads-accounts-and-expenses-public-api`), porque a fatura lê e quita as despesas de cartão pela interface do `expenses` (spec 0013, INV-0013-12). Nenhum outro módulo de domínio pode ser importado por eles, e `expenses` nunca importa `statements`. `reporting` lê os outros contextos por SQL próprio, sem entidade nem repositório deles, e só importa `src/statements/index.ts` (regra `reporting-reads-statements-public-api`), para as faturas futuras (spec 0015, INV-0015-01).

### Análise de segurança do código

Decidida pelo responsável em 2026-10-10 (D5 do levantamento da Fase 3): um gate que analisa o
código em busca de vulnerabilidades, além do `audit`, que só olha as dependências.

- **Gate `sast`:** `scripts/sast.mjs` roda o Semgrep CE em `src/` e `scripts/`.
    - **Regras:** os pacotes `p/javascript`, `p/typescript`, `p/nodejs`, `p/expressjs` e
      `p/secrets` do registro do Semgrep.
    - **Limiar:** qualquer achado de severidade `ERROR` ou `WARNING` reprova (`--error`). `INFO`
      não é avaliado.
    - **Versão:** fixada no script (`SEMGREP_VERSION`). O script usa a imagem
      `semgrep/semgrep:<versão>` pelo Docker, que o gate `test` já exige, e o `semgrep` instalado
      na máquina só quando não há Docker.
    - **Métricas:** desligadas (`--metrics=off`).
    - **Rede:** os pacotes são baixados do registro a cada execução. Sem rede o gate falha; ele
      não vira SKIP.
    - **Disponibilidade:** sem `docker` nem `semgrep` no PATH, o gate é SKIP (ambiente) com o
      motivo na tabela.
- **Supressão:** só pontual, com `// nosemgrep: <id-da-regra>` na linha e o motivo no comentário,
  como manda a política de alteração abaixo. Nunca por arquivo ou diretório inteiro.
- **CodeQL, complementar:** `.github/workflows/codeql.yml` roda a análise `security-extended` do
  CodeQL para `javascript-typescript` em PR e push para `develop` e `main`, e uma vez por semana.
    - **Não é um gate:** não roda no `npm run check`, não reimplementa o `sast` e não entra no
      `ci.yml` (INV-0002-03).
    - **Resultado:** os alertas aparecem na aba _Security_ do repositório. Tornar o check do
      CodeQL obrigatório no merge é decisão do responsável, fora desta spec.
    - **Por que os dois:** o Semgrep é rápido, roda igual local e no CI e casa padrões; o CodeQL
      segue o fluxo de dados entre arquivos, mas só roda no GitHub.

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
- **INV-0002-06:** o gate `sast` reprova qualquer achado `ERROR` ou `WARNING` dos pacotes de regras
  desta spec; uma supressão é sempre pontual, com a regra e o motivo na própria linha.

## Error cases

| Situação                                    | Comportamento exigido                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| Ferramenta não instalada, modo normal       | SKIP (ambiente ou contexto), com motivo na tabela; código de saída não é afetado     |
| Ferramenta não instalada, `--require-tools` | FAIL, com mensagem indicando qual ferramenta falta                                   |
| Gate falha                                  | registrar a falha, seguir para os demais, reportar tudo ao final e sair com código 1 |
| Script de gate inexistente                  | tratado como SKIP (contexto), citando o caminho esperado                             |
| Sem `docker` nem `semgrep` no PATH          | `sast` é SKIP (ambiente), citando as duas ferramentas; no CI, FAIL                   |
| Registro do Semgrep fora do ar ou sem rede  | `sast` é FAIL, nunca SKIP nem PASS                                                   |

## Acceptance criteria

- **AC-0002-01:** `npm run check` executa todos os gates disponíveis e imprime tabela final com estado e motivo.
- **AC-0002-02:** `npm run check` sai com código 1 quando ao menos um gate falha, e 0 quando não há falha.
- **AC-0002-03:** `npm run check -- --require-tools` sai com código 1 se qualquer gate for pulado.
- **AC-0002-04:** `.github/workflows/ci.yml` executa o orquestrador com `--require-tools` e nenhum outro comando de verificação.
- **AC-0002-05:** o gate `sast` é PASS no código atual e FAIL com um achado: um trecho que escreve
  `req.query` direto na resposta e faz `eval` de `req.body`, posto em `src/` só para a prova, sai
  com código 1 e cita as regras.
- **AC-0002-06:** `.github/workflows/codeql.yml` analisa `javascript-typescript` com
  `security-extended` em PR e push para `develop` e `main` e semanalmente, e o run no próprio PR que
  o cria termina com a análise publicada.

## Test mapping

| Item                                                          | Teste                                                                                     |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| AC-0002-01, AC-0002-02, INV-0002-01, INV-0002-02, INV-0002-04 | execução manual documentada no PR do seed; testes de unidade do orquestrador em T-0002-01 |
| AC-0002-03, INV-0002-05                                       | execução do modo estrito no CI                                                            |
| AC-0002-04, INV-0002-03                                       | inspeção de `.github/workflows/ci.yml` em revisão de PR                                   |
| AC-0002-05, INV-0002-06                                       | `tests/unit/scripts/check.spec.ts` (gate no orquestrador) e prova manual no PR (achado)   |
| AC-0002-06                                                    | inspeção do workflow em revisão e o run do CodeQL no PR                                   |

## Open questions

Nenhuma.
