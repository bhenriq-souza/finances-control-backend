---
id: '0002'
title: Catálogo de eventos de domínio em `src/events/`
status: accepted
---

# ADR-0002 (local) — Catálogo de eventos de domínio em `src/events/`

## Context

O [ADR-0005 do hub](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0005-queue.md)
faz dos eventos de domínio o canal entre contextos para efeitos que não são invariantes. Um evento
tem publicador e consumidores em módulos diferentes, e os dois lados precisam do **mesmo contrato**:
o nome e o tipo do payload.

O gate `boundaries` (spec 0002) proíbe que um módulo de domínio importe de outro, e o
`dependency-cruiser` está configurado com `tsPreCompilationDeps: true` — um `import type` conta como
dependência. Se o contrato do evento viver no módulo publicador, o consumidor não consegue tipar o
handler sem violar a regra 2 do ADR-0003. E `platform` não pode conhecer eventos de domínio
(INV-0003-09).

## Decision

- Os contratos de evento vivem em `src/events/`, um arquivo por módulo publicador
  (`src/events/<módulo>.events.ts`), reexportados por `src/events/index.ts`.
- O diretório contém **apenas tipos e constantes de nome**. Importa somente de `src/platform` (o
  envelope `DomainEvent`). Não importa de módulo de domínio, e `src/platform` não importa dele.
- As duas proibições são regras de erro no `.dependency-cruiser.cjs`, ao lado das regras do
  ADR-0003. `src/events/` não entra na lista `DOMAIN`: não é um módulo, é a linguagem publicada
  entre eles.
- Um módulo só publica os eventos do seu próprio arquivo no catálogo (INV-0004-08, spec 0004).

## Consequences

- Publicador e consumidor compilam contra o mesmo tipo sem se importarem, e o gate continua a
  reprovar qualquer outro acoplamento entre módulos.
- Adicionar um evento é uma mudança de contrato visível: passa pelo catálogo, e o PR mostra quem
  passa a depender dele.
- O catálogo não pode crescer para além de tipos e nomes. Lógica de evento, se surgir, pertence ao
  módulo publicador ou à plataforma.
- Extrair um módulo para serviço próprio no futuro leva junto o seu arquivo do catálogo, que já
  descreve o que ele emite.

## Alternatives considered

- **Contrato no módulo publicador, com exceção para `import type` no gate**
  (`dependencyTypesNot: ['type-only']`): resolveria o caso, mas abriria a mesma exceção para tipos
  de entidade e de repositório, que a regra 2 do ADR-0003 proíbe. A exceção seria mais larga do que
  o problema.
- **Contrato em `src/platform/`**: a plataforma passaria a conhecer o vocabulário de cada contexto,
  invertendo a dependência que a INV-0003-09 e o gate `platform-must-not-depend-on-domain`
  protegem.
- **Payload não tipado (`unknown`) e validação em runtime no consumidor**: elimina a dependência ao
  custo de perder o contrato em tempo de compilação, e cada consumidor passaria a duplicar um
  schema que o publicador já conhece.
