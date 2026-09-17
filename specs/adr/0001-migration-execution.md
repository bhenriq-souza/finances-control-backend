---
id: '0001'
title: Execução e formato das migrations
status: accepted
---

# ADR-0001 (local) — Execução e formato das migrations

## Context

O backend passa a ter schema versionado ([ADR-0004 do hub](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0004-database.md):
PostgreSQL 16 + TypeORM). É preciso decidir **onde** as migrations rodam no ciclo de deploy e em que
**formato** elas são escritas.

Restrições do ambiente: o deploy é GitOps — o Argo CD reconcilia manifests do `homelab-gitops`, e o
pipeline só troca a tag da imagem; o deployment tem uma réplica; a imagem é construída com
`npm ci --omit=dev`, roda como usuário `node` e com `readOnlyRootFilesystem: true`; não há passo
imperativo de deploy onde encaixar um comando.

## Decision

- As migrations rodam num **initContainer** chamado `migrations`, na mesma imagem do app e com as
  mesmas variáveis de ambiente, executando `typeorm migration:run` contra
  `dist/src/platform/database/data-source.js`. A aplicação nunca aplica migration no boot.
- Por isso `typeorm` e `pg` são dependências de **runtime**, não de desenvolvimento.
- O formato é a **classe TypeScript** gerada por `migration:generate`, com `up` e `down`, revisada à
  mão antes do commit — não SQL solto em arquivos numerados.

## Consequences

- A ordem fica garantida sem coordenação: o container da aplicação só inicia depois de o
  initContainer sair com sucesso. Com uma réplica, não há janela em que código novo veja schema velho.
- Migration que falha derruba o rollout, não a aplicação: o pod novo não fica Ready e a réplica
  anterior continua servindo.
- A cada reinício de pod o `migration:run` roda de novo. É idempotente — consulta a tabela de
  controle e não faz nada quando não há pendência — ao custo de uma conexão a mais no start.
- Com mais de uma réplica no futuro, dois initContainers podem rodar em paralelo; o lock consultivo
  do TypeORM cobre o caso, mas isso precisa ser revalidado antes de escalar.
- Escrever a migration em TypeScript permite reusar `queryRunner` e tipos, e mantém `up`/`down`
  no mesmo arquivo revisado em PR.

## Alternatives considered

- **Aplicar no boot da aplicação** (`migrationsRun: true`): simples, mas mistura responsabilidades,
  atrasa o readiness e, com múltiplas réplicas, faz todas competirem pelo schema. Uma migration que
  falha vira crash loop em vez de rollout barrado.
- **Job com hook `PreSync` do Argo CD**: semanticamente mais correto — roda uma vez por sync, não por
  reinício de pod — mas duplica a definição de imagem e de env fora do deployment, e a falha aparece
  como sync travado, mais difícil de diagnosticar. Revisitar se o custo do `migration:run` por
  reinício incomodar.
- **SQL puro versionado** (estilo Flyway, com `node-pg-migrate` ou script próprio): remove a mágica do
  `generate`, mas obriga a manter entidade e DDL sincronizadas à mão, sem o diff que denuncia o
  esquecimento.
