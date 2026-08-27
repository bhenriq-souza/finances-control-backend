---
id: '0001'
title: Fluxo de desenvolvimento (branches, commits, pull requests)
status: approved
depends_on: ['0000']
---

# 0001 — Fluxo de Desenvolvimento

## Goal

Definir o fluxo Git que todo contribuidor — humano ou agente de IA — deve seguir: nomenclatura e ritual de criação de branch, convenção de mensagens de commit, pull requests padronizados com revisão humana obrigatória, e a camada de enforcement no host (GitHub) que torna as regras difíceis de burlar.

## Scope / Non-goals

- **Em escopo:** modelo de branches, ritual de sincronização, Conventional Commits, template e ciclo de vida de PR, estratégia de merge, proteção de branch, CI em PRs, atualização de rastreabilidade.
- **Fora de escopo:** processo de release e versionamento (ADR futuro); os gates em si (spec 0002); o pipeline de build e deploy de imagem (ver requisitos de CI/CD no hub).

## Contracts

### Modelo de branches

- **`develop` é a branch padrão.** Todo trabalho parte de `develop`; todo PR mira `develop`. `main` é a branch de promoção para produção, alimentada por PR de `develop` quando houver release (ver roadmap, Fase 4).
- Uma tarefa do backlog (`T-xxxx-yy`) = uma branch = um PR. Nunca uma branch com várias tarefas.

### Ritual de criação de branch (normativo — exatamente nesta ordem)

```bash
git checkout develop
git pull origin develop
git checkout -b <tipo>/<task-id>-<slug>
```

Criar branch a partir de qualquer coisa que não seja uma `develop` **recém-puxada** viola INV-0001-03. Se `develop` andar enquanto a branch está aberta, faça rebase antes de pedir revisão.

### Convenção de nomes de branch

```
<tipo>/<task-id>-<slug>
```

- `tipo`: um dos tipos de Conventional Commit (`feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`).
- `task-id`: ID do backlog em minúsculas, ex.: `t-0012-01`. Para trabalho fora do backlog (correção de spec, seed, hotfix), use o ID da issue (`fcb-001`) ou `misc`.
- `slug`: descrição curta em kebab-case.

Exemplos: `feat/t-0012-01-expense-entity`, `docs/t-0000-01-spec-checker`, `chore/fcb-001-agentic-kit-seed`.

### Convenção de mensagem de commit — [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)

```
<tipo>(<escopo>): <resumo no imperativo, ≤ 72 caracteres>

<corpo: o quê e por quê, quebrado em 100 colunas>

Task: T-0012-01
```

- **Tipos:** `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci` (com `!` para quebra de contrato interno).
- **Escopo:** o módulo tocado — `identity`, `accounts`, `expenses`, `statements`, `earnings`, `reporting`, `imports`, `platform`, `specs`, `workflow`. Omitir apenas em mudanças que atingem o repositório inteiro.
- **Rodapé:** todo commit de branch de tarefa carrega o rodapé `Task:` com o ID do backlog.
- Verificado localmente por hook `commit-msg` (commitlint), configurado junto ao scaffold (T-0002-02).

### Pull requests

- Abertos ao fim de toda tarefa, da branch de tarefa para `develop`, via `gh pr create` usando `.github/PULL_REQUEST_TEMPLATE.md`.
- **Título do PR = cabeçalho do commit de squash** (formato Conventional Commit): `feat(expenses): implement installment generation (T-0012-03)`.
- Seções do template (normativas): _Task_, _Specs_, _What & why_, _Definition of done_, _Test evidence_, _Notes for review_.
- **O merge é decisão do responsável pelo repositório.** Agentes abrem PRs e respondem à revisão; **nunca fazem merge** (INV-0001-04).
- **Estratégia de merge: squash**, com exclusão da branch depois. O histórico de `develop` fica com um commit por tarefa, titulado em Conventional Commit.

### Proteção de branch em `develop`

Configuração ativa:

1. Exigir pull request antes do merge — sem push direto, inclusive para administradores.
2. Proibir force push e exclusão da branch.
3. Exigir status check verde (`ci`) — **ativação faseada**, ver abaixo.

**Sobre aprovação obrigatória:** o repositório tem um único mantenedor, e o GitHub não permite que o autor aprove o próprio PR. Exigir aprovação formal travaria todo PR criado pelo responsável. Portanto, o _"agentes nunca fazem merge"_ é mantido como **regra de conduta normativa** (INV-0001-04) e não como bloqueio do host — a exigência de PR (regra 1) já impede que trabalho entre em `develop` sem passar por revisão explícita.

**Ativação faseada da regra 3:** o status check obrigatório só é habilitado **após** o primeiro PR que introduz o tooling ser mergeado e o workflow `ci` ter executado ao menos uma vez. Habilitar antes causa deadlock: o PR que cria o check nunca satisfaz o check que ele mesmo cria.

**Exceção de bootstrap:** commits feitos antes de a proteção existir permanecem no histórico. A partir da ativação, tudo passa por PR — inclusive mudanças em specs e neste fluxo.

### CI em PRs — `.github/workflows/ci.yml`

Roda em todo PR para `develop`: checkout → setup Node → `npm ci` → `npm run check -- --require-tools`. O CI **não reimplementa gate nenhum**: ele apenas invoca o orquestrador único (spec 0002), garantindo que local e CI executem os mesmos comandos.

### Ciclo de vida da tarefa (rastreabilidade)

No mesmo PR que conclui uma tarefa: marcar o checkbox em `docs/backlog.md` e, se for a última tarefa da spec, mudar o `status` da spec para `implemented`. Tarefa sem atualização de backlog não está pronta.

## Invariants

- **INV-0001-01:** depois da ativação da proteção, nenhum commit chega a `develop` a não ser por PR com CI verde e merge por squash.
- **INV-0001-02:** todo commit em `develop` rastreia até uma tarefa ou spec (título ou rodapé).
- **INV-0001-03:** branches de trabalho são criadas apenas a partir de uma `develop` recém-puxada.
- **INV-0001-04:** agentes nunca fazem merge de PR; merge é ação humana.
- **INV-0001-05:** o CI executa exatamente os mesmos comandos do pipeline local de qualidade (spec 0002).

## Error cases

| Situação                                   | Comportamento exigido                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `develop` andou com a branch aberta        | rebase sobre a `develop` atualizada; resolver conflito na branch, nunca em `develop` |
| CI vermelho no PR                          | corrigir na branch antes de pedir revisão; nunca mergear vermelho                    |
| Hook rejeita a mensagem de commit          | reescrever a mensagem; nunca usar `--no-verify`                                      |
| Revisão pede mudanças                      | tratar na mesma branch e no mesmo PR; pedir nova revisão                             |
| Tarefa mal especificada descoberta no meio | parar; corrigir a spec primeiro, em PR `docs/` separado; depois retomar              |

## Acceptance criteria

- **AC-0001-01:** a proteção de `develop` está ativa com as regras 1 e 2 (verificável em configurações do repositório).
- **AC-0001-02:** um PR canário exibe o template, dispara o workflow `ci` e não pode ser mergeado sem revisão explícita do responsável.
- **AC-0001-03:** após o primeiro PR de tooling ser mergeado, o status check `ci` é tornado obrigatório (regra 3).
- **AC-0001-04:** `git log develop --oneline` após as primeiras tarefas mostra um commit titulado em Conventional Commit por tarefa.

## Test mapping

| Item                   | Teste                                                                    |
| ---------------------- | ------------------------------------------------------------------------ |
| AC-0001-01, AC-0001-02 | PR canário do seed (FCB-001) — verificação manual de configuração        |
| AC-0001-03             | checklist pós-merge do seed, registrado em `docs/backlog.md` (T-0001-01) |
| AC-0001-04             | inspeção manual após as primeiras tarefas mergeadas                      |
| INV-0001-05            | `.github/workflows/ci.yml` invoca `npm run check` e nada mais            |

## Open questions

Nenhuma.
