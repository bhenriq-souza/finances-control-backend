---
name: implement-task
description: Implementa uma tarefa do backlog de ponta a ponta seguindo o fluxo spec-driven — lê a tarefa e sua spec, cria a branch a partir de develop recém-puxada, implementa com testes, roda os gates e abre um PR padronizado. Use quando pedirem para implementar uma tarefa como T-0012-01.
---

# Implementar uma tarefa do backlog

Argumento: um ID de tarefa (`T-xxxx-yy`). Se não vier, pegue a primeira tarefa não marcada em `docs/backlog.md` e confirme com o usuário.

## Passos

1. **Leia a tarefa** em `docs/backlog.md`: What / Where / Done when. Leia a spec referenciada por inteiro (contratos, invariantes, casos de erro, ACs, test mapping). Leia `AGENTS.md` se ainda não estiver em contexto.
2. **Verifique as precondições:** as tarefas anteriores implicadas pela cadeia `depends_on` da spec estão concluídas. Se a tarefa estiver ambígua ou conflitar com sua spec, **PARE e reporte** — a spec é corrigida primeiro, em PR `docs/` separado.
3. **Ritual de branch (nunca pule):**
    ```bash
    git checkout develop && git pull origin develop
    git checkout -b <tipo>/<task-id-minúsculo>-<slug>
    ```
4. **Implemente** exatamente os contratos referenciados — nomes de campo, tipos e defaults literalmente como na spec. Escreva os testes mapeados na mesma branch.
5. **Respeite as regras não-negociáveis:** invariantes financeiras na mesma transação (ADR-0003, regra 4); dinheiro fora de ponto flutuante (INV-0000-04); fronteiras de módulo (acesso só por interface pública, nada de repositório alheio, efeitos entre módulos por evento de domínio).
6. **Rode os gates** — invoque a skill `/check`. Todos precisam passar; corrija até ficar verde.
7. **Atualize a rastreabilidade na mesma branch:** marque o checkbox da tarefa em `docs/backlog.md`; se esta foi a última tarefa da spec, mude o `status` dela para `implemented`.
8. **Commit** em Conventional Commits (escopo = módulo, rodapé `Task: T-xxxx-yy`). Pode dividir em commits lógicos — eles serão squashados.
9. **Abra o PR** — invoque a skill `/finish-task`.
10. **PARE depois que o PR estiver aberto.** Nunca faça merge; nunca faça push em `develop`. Reporte a URL do PR e o resumo das evidências.
