---
id: '0000'
title: Processo de specs e convenções
status: approved
depends_on: []
---

# 0000 — Processo de Specs e Convenções

## Goal

Definir como specs, ADRs e tarefas são escritos, ligados e validados neste repositório, de modo que agentes de IA (e humanos) implementem itens de trabalho de forma independente, verificável e sem ambiguidade.

## Scope / Non-goals

- **Em escopo:** template de spec, ciclo de vida, formato de tarefa, definition of done, faixas de numeração, convenções normativas transversais e rastreabilidade com o board.
- **Fora de escopo:** o conteúdo de qualquer feature específica (specs 0010+); o fluxo Git (spec 0001); a configuração dos gates (spec 0002); decisões de arquitetura de produto (ADRs no repositório hub).

## Contracts

### Template de spec

Toda spec é um arquivo Markdown `specs/NNNN-titulo-kebab.md` com frontmatter YAML:

```yaml
---
id: 'NNNN' # com zeros à esquerda, único, nunca reutilizado
title: Título curto
status: draft | approved | implemented | superseded
depends_on: ['NNNN', ...] # IDs de specs sobre as quais esta se apoia
---
```

Seções obrigatórias, nesta ordem:

1. **Goal** — um parágrafo: o que esta spec torna verdadeiro.
2. **Scope / Non-goals** — fronteiras explícitas.
3. **Contracts** — schemas de entrada/saída (campos e tipos), interfaces, formatos de arquivo, rotas HTTP. Contratos são normativos: implementações batem nomes e tipos exatamente.
4. **Invariants** — propriedades que valem sempre; cada uma recebe um ID `INV-NNNN-nn` para ser referenciada por testes.
5. **Error cases** — falhas enumeradas com código de erro, comportamento esperado e forma da mensagem ao usuário.
6. **Acceptance criteria** — afirmações numeradas e objetivamente verificáveis `AC-NNNN-nn`.
7. **Test mapping** — tabela ligando critérios de aceite e invariantes aos testes planejados.
8. **Open questions** — itens não resolvidos; deve estar vazia antes de `status: approved`.

### Faixas de numeração

| Faixa         | Uso                                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0000`–`0009` | Processo e plataforma (processo de specs, workflow, gates, configuração, DI, observabilidade)                                                                   |
| `0010`–`0099` | Domínio, na ordem dos requisitos de negócio (`0010` identity/F001, `0011` accounts/F002, `0012` expenses/F003, `0013` statements/F004, `0014` earnings/F005, …) |

IDs nunca são reutilizados, mesmo após `superseded`.

### Template de ADR local

`specs/adr/NNNN-titulo-kebab.md` com as seções **Context**, **Decision**, **Consequences**, **Alternatives considered**, e `status: accepted | superseded` no frontmatter. ADRs são **imutáveis** depois de aceitos: mudanças criam um novo ADR que supersede o anterior.

Decisões de produto e de arquitetura macro **não** vivem aqui — vivem em `docs/adr/` do repositório hub e são referenciadas por link.

### Formato de tarefa

Tarefas vivem em `docs/backlog.md`. Formato do ID: `T-<id-da-spec>-<nn>` (ex.: `T-0012-03` = tarefa 03 da spec 0012). Cada tarefa declara:

- **What** — um único entregável pequeno (alvo: implementável em uma sessão focada).
- **Where** — caminho do módulo/arquivo alvo.
- **Done when** — os critérios de aceite e testes que precisa satisfazer, por IDs `AC-*` / `INV-*`.

Uma tarefa não pode exigir interpretação além da sua spec. Se exigir, a spec é corrigida primeiro.

### Rastreabilidade com o board

O board [Finances Control](https://github.com/users/bhenriq-souza/projects/2) e as issues `FCB-*` são a camada de **entrega**: cada issue de domínio corresponde a uma spec e ao conjunto das suas tarefas. O `docs/backlog.md` é a camada de **execução**, mais granular, e é a fila que os agentes consomem.

Regra: ao concluir a última tarefa de uma spec, o PR que a fecha referencia a issue `FCB-*` correspondente (`Closes #N`), fechando as duas camadas juntas.

## Invariants

- **INV-0000-01:** toda spec tem frontmatter completo e as oito seções, na ordem.
- **INV-0000-02:** toda tarefa do backlog referencia um ID de spec existente e ao menos um item `AC-*` ou `INV-*`.
- **INV-0000-03:** referências em `depends_on` resolvem para IDs de specs existentes, e o grafo de dependências é acíclico.
- **INV-0000-04:** valores monetários nunca são representados em ponto flutuante — persistidos como `numeric` e manipulados como inteiro de centavos ou string decimal.
- **INV-0000-05:** specs, ADRs, backlog e documentação em português; código, identificadores, commits e PRs em inglês.

## Error cases

Não se aplica (spec de processo). Violações de INV-0000-01..03 são reprovadas pelo gate `check-specs` (spec 0002) com mensagem apontando arquivo e seção faltante.

## Acceptance criteria

- **AC-0000-01:** o gate `check-specs` verifica INV-0000-01 e INV-0000-03 em toda a árvore `specs/` e falha com diagnóstico acionável.
- **AC-0000-02:** o gate `check-specs` verifica INV-0000-02 para todas as tarefas declaradas em `docs/backlog.md`.
- **AC-0000-03:** uma spec com a seção _Open questions_ não vazia não pode estar em `status: approved`.

## Test mapping

| Item                                             | Teste                                             |
| ------------------------------------------------ | ------------------------------------------------- |
| AC-0000-01, AC-0000-03, INV-0000-01, INV-0000-03 | `scripts/check-specs.mjs`                         |
| AC-0000-02, INV-0000-02                          | `scripts/check-specs.mjs` (seção de backlog)      |
| INV-0000-04                                      | testes de domínio das specs 0011+ e revisão em PR |
| INV-0000-05                                      | revisão em PR                                     |

## Open questions

Nenhuma.
