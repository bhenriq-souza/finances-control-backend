---
name: new-spec
description: Cria ou revisa uma spec seguindo o template 0000 (frontmatter + oito seções obrigatórias), registra no índice e adiciona suas tarefas ao backlog. Use quando pedirem para criar uma spec, formalizar uma feature, ou quando uma tarefa exigir correção de spec primeiro.
---

# Criar ou revisar uma spec

## Passos

1. Leia `specs/0000-spec-process.md` (template, ciclo de vida, formato de tarefa) se ainda não estiver em contexto.
2. **Spec nova:** próximo ID livre dentro da faixa correta (`0000`–`0009` processo/plataforma, `0010`+ domínio na ordem dos requisitos). IDs nunca são reutilizados. **Revisão de spec aprovada:** edite no lugar apenas enquanto nada que dependa da parte alterada estiver implementado; caso contrário documente a mudança explicitamente no PR.
3. Decisões de arquitetura **não** viram spec: decisões de produto vão para `docs/adr/` do repositório hub; decisões locais do backend vão para `specs/adr/` — imutáveis depois de aceitas, superseda em vez de editar.
4. Escreva a spec com frontmatter (`id`, `title`, `status: draft`, `depends_on`) e as oito seções na ordem: Goal · Scope/Non-goals · Contracts · Invariants (`INV-NNNN-nn`) · Error cases (`ERR-NNNN-nn`) · Acceptance criteria (`AC-NNNN-nn`) · Test mapping · Open questions.
5. Reutilize nomes existentes literalmente (nomes de módulo, códigos de erro, chaves de configuração, rotas). Nunca invente um nome paralelo para um conceito que já existe.
6. Respeite as invariantes transversais da spec 0000 — em especial INV-0000-04 (dinheiro fora de ponto flutuante) — e as regras do ADR-0003 sobre fronteiras de módulo e invariantes transacionais.
7. Registre: adicione a linha em `specs/README.md` e as tarefas (`T-<id>-<nn>`, com What/Where/Done when) em `docs/backlog.md`, em ordem de dependência. Toda tarefa cita ao menos um `AC-*` ou `INV-*` — o gate `check-specs` reprova se faltar.
8. Rode `npm run check` e entregue pelo fluxo padrão: branch `docs/`, Conventional Commit (`docs(specs): …`), PR via `/finish-task`. O `status` só vira `approved` quando _Open questions_ estiver vazia e o responsável aprovar o PR.
