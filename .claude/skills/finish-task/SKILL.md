---
name: finish-task
description: Verifica a definition of done de uma tarefa e abre o pull request padronizado para develop (nunca faz merge). Use ao final de uma branch de tarefa, ou quando pedirem para abrir/preparar um PR.
---

# Finalizar uma tarefa: verificação de DoD + PR

Precondição: você está numa branch de tarefa (`<tipo>/<task-id>-<slug>`), com o trabalho commitado.

## Passos

1. **Verifique a DoD** (spec 0000), tudo isto:
    - Contratos batem exatamente com a spec; testes mapeados existem e passam.
    - `/check` totalmente verde (rode agora se não acabou de rodar).
    - Checkbox do backlog marcado; `status` da spec alterado se foi a última tarefa.
    - Invariantes financeiras resolvidas na mesma transação e dinheiro fora de ponto flutuante, quando aplicável.
2. **Rebase se necessário:** se `develop` andou desde o branch, `git fetch origin && git rebase origin/develop`, resolva na branch e rode `/check` de novo.
3. **Push** da branch: `git push -u origin HEAD`.
4. **Abra o PR** mirando `develop`:
    ```bash
    gh pr create --base develop --title "<tipo>(<escopo>): <resumo> (T-xxxx-yy)" --body-file <template preenchido>
    ```
    - Título = cabeçalho Conventional Commit (vira o commit de squash em `develop`).
    - Preencha **todas** as seções de `.github/PULL_REQUEST_TEMPLATE.md`: task, specs, what & why, checkboxes da DoD (marque só o que você verificou), evidência de teste (cole a saída real) e notas para revisão.
    - Se a tarefa encerra uma issue de entrega, inclua `Closes #N`.
5. **PARE.** O merge é decisão do responsável pelo repositório (spec 0001, INV-0001-04). Reporte a URL do PR. Se vier feedback de revisão depois, trate na mesma branch e peça nova revisão.
