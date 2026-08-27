# Manual Operacional de Agentes — finances-control-backend

Este é um repositório **spec-driven**. O comportamento é definido em `specs/`, o trabalho vive em `docs/backlog.md`. **Não improvise além da spec**: se uma tarefa estiver ambígua, a spec é corrigida primeiro (spec 0000), em PR separado.

Contexto de produto (requisitos, ADRs de arquitetura, roadmap): repositório hub [finances-control](https://github.com/bhenriq-souza/finances-control).

## Leia antes de trabalhar

1. `specs/0000-spec-process.md` — processo, formato de tarefa, definition of done, convenções normativas.
2. `specs/0001-development-workflow.md` — o fluxo Git que você **deve** seguir.
3. `specs/0002-quality-gates.md` — os portões de qualidade e o orquestrador único.
4. A(s) spec(s) referenciada(s) pela sua tarefa em `docs/backlog.md`.

## Regras de ouro

1. **Uma tarefa = uma branch = um PR.** IDs de tarefa têm a forma `T-0010-01`.
2. **Ritual de branch, sempre:**
   ```bash
   git checkout develop && git pull origin develop
   git checkout -b <tipo>/<task-id>-<slug>     # ex.: feat/t-0010-01-user-entity
   ```
3. **Conventional Commits** (`feat|fix|docs|test|refactor|chore|ci`), escopo = módulo, rodapé `Task: T-xxxx-yy`. Nunca use `--no-verify`.
4. **Abra um PR ao final da tarefa** (`gh pr create`, o template se aplica sozinho). Título do PR em formato Conventional Commit. **Nunca faça merge** — o merge é decisão do responsável, após revisão. Nunca faça push direto em `develop`.
5. **Definition of done** (spec 0000): contratos implementados exatamente, testes mapeados passando, todos os gates verdes, checkbox do backlog marcado no mesmo PR, `status` da spec alterado quando for a última tarefa dela.
6. **Invariantes financeiras resolvem-se na mesma transação** ([ADR-0003](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0003-architecture-style.md), regra 4). Saldo de conta, limite disponível de cartão e geração de parcelas **nunca** dependem de processamento assíncrono. Eventos de domínio servem a efeitos que toleram atraso ([ADR-0005](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0005-queue.md)).
7. **Dinheiro nunca é ponto flutuante** (INV-0000-04). Persistir em `numeric`; representar em TypeScript como inteiro de centavos ou string decimal — jamais `number` com fração.
8. **Fronteiras de módulo são normativas** (ADR-0003, regras 1–3): acesso só pela interface pública do módulo; nada de tocar repositório ou entidade de outro módulo; efeitos entre módulos que não sejam invariantes viajam como evento de domínio. Verificado por gate.
9. **Nunca invente resultado de teste.** Cole o resumo real do Jest. Se um gate está vermelho, a tarefa não está pronta.
10. **Nunca afrouxe um gate para passar.** Mudar configuração de gate exige alterar a spec 0002 no seu próprio PR.
11. As skills do repositório automatizam o processo — prefira-as: `/new-spec`, `/implement-task`, `/check`, `/finish-task` (ver `.claude/skills/`).

## Portões de qualidade

Um comando só — o CI executa exatamente o mesmo (INV-0002-03):

```bash
npm run check
```

Ele orquestra: formatação, lint, tipos, contratos de fronteira entre módulos, testes com cobertura, auditoria de dependências e validação estrutural das specs. Detalhes e política de PASS/FAIL/SKIP na spec 0002.

## Mapa do repositório

| Caminho | O que é |
|---|---|
| `specs/` | Specs normativas (contratos, invariantes, ACs) |
| `specs/adr/` | Decisões **locais do backend** (ver abaixo) |
| `docs/backlog.md` | Tarefas ordenadas — sua fila de trabalho |
| `scripts/check.mjs` | Orquestrador único dos gates |
| `scripts/check-specs.mjs` | Validador estrutural das specs |
| `src/<módulo>/` | Módulos por contexto (ADR-0003) |
| `src/platform/` | Infra transversal: config, DB, logging, erros, eventos |

### Onde cada decisão é registrada

- **Produto e arquitetura macro** (stack, banco, estilo arquitetural, autenticação): ADRs no **hub**, em `docs/adr/`. Não duplique aqui — referencie por link.
- **Decisões locais do backend** (organização interna, escolha de biblioteca pontual, formato de migration): `specs/adr/` deste repositório.
- Em ambos os casos ADRs são **imutáveis** depois de aceitos: para mudar, crie um novo que supersede.

## Módulos (ADR-0003)

`identity` (F001) · `accounts` (F002) · `expenses` (F003) · `statements` (F004) · `earnings` (F005) · `reporting` · `imports` · `platform`

`reporting` é o único autorizado a ler múltiplos contextos, e apenas para leitura.

## Idioma

Specs, ADRs, backlog e documentação em **português**. Código, identificadores, mensagens de commit, títulos e corpo de PR em **inglês**. Não misture dentro de um mesmo artefato.
