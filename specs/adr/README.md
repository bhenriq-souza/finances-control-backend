# ADRs locais do backend

Decisões **restritas a este repositório**: organização interna, escolha pontual de biblioteca, formato de migration, convenção de teste.

Decisões de **produto e arquitetura macro** — stack, banco de dados, estilo arquitetural, autenticação, mensageria — vivem no repositório hub, em [`docs/adr/`](https://github.com/bhenriq-souza/finances-control/tree/main/docs/adr). Não duplique aqui: referencie por link.

Formato: `NNNN-titulo-kebab.md`, com frontmatter `status: accepted | superseded` e as seções **Context**, **Decision**, **Consequences**, **Alternatives considered**. ADRs são imutáveis depois de aceitos — para mudar, crie um novo que supersede o anterior.

| ADR                                  | Título                                          | Status   |
| ------------------------------------ | ----------------------------------------------- | -------- |
| [0001](0001-migration-execution.md)  | Execução e formato das migrations               | accepted |
| [0002](0002-domain-event-catalog.md) | Catálogo de eventos de domínio em `src/events/` | accepted |
