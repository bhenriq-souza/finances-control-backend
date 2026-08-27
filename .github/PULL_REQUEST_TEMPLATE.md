<!-- O título do PR DEVE ser um cabeçalho Conventional Commit, ex.:
     feat(expenses): implement installment generation (T-0012-03)
     Ele vira a mensagem do commit de squash em develop. -->

## Task

<!-- ID do backlog + uma linha, ex.: T-0012-03 — gerar parcelas futuras (docs/backlog.md).
     Se fechar uma issue de entrega, acrescente: Closes #N -->

## Specs

<!-- IDs de specs implementadas/afetadas, ex.: 0012 (implementa), 0002 (INV-0002-01 usado) -->

## What & why

<!-- 2 a 5 frases: o que mudou e por quê, para quem não acompanhou a branch. -->

## Definition of done

- [ ] Contratos batem exatamente com a spec (nomes, tipos, defaults)
- [ ] Testes mapeados implementados e passando (liste os `AC-*` / `INV-*` na evidência)
- [ ] `npm run check` verde localmente
- [ ] Checkbox do backlog marcado neste PR; `status` da spec atualizado se esta foi sua última tarefa
- [ ] Invariantes financeiras resolvidas na mesma transação (ADR-0003, regra 4), quando aplicável
- [ ] Valores monetários fora de ponto flutuante (INV-0000-04), quando aplicável

## Test evidence

<!-- Cole o resumo real do Jest e da tabela do `npm run check`, e os ACs que eles provam.
     Nunca descreva um resultado que você não executou. -->

## Notes for review

<!-- Trade-offs, desvios propostos (exigem mudança de spec antes), pontos que pedem atenção. -->
