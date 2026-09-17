# Specs

Specs normativas deste repositório. Processo, template e ciclo de vida em [0000](0000-spec-process.md).

Faixas: `0000`–`0009` processo e plataforma · `0010`+ domínio, na ordem dos requisitos de negócio.

| ID                                   | Título                                                      | Status      |
| ------------------------------------ | ----------------------------------------------------------- | ----------- |
| [0000](0000-spec-process.md)         | Processo de specs e convenções                              | approved    |
| [0001](0001-development-workflow.md) | Fluxo de desenvolvimento (branches, commits, pull requests) | approved    |
| [0002](0002-quality-gates.md)        | Portões de qualidade e orquestrador único                   | approved    |
| [0003](0003-persistence.md)          | Persistência — PostgreSQL, TypeORM e migrations             | implemented |
| [0010](0010-identity.md)             | Identity — usuários, autenticação e RBAC                    | implemented |
| [0011](0011-accounts.md)             | Accounts — bancos, contas bancárias e cartões de crédito    | implemented |

Specs de domínio planejadas (ainda não escritas): `0012` expenses (F003) · `0013` statements (F004) · `0014` earnings (F005) · `0015` reporting · `0016` imports.

Decisões de arquitetura: as de **produto** vivem em [`docs/adr/` do hub](https://github.com/bhenriq-souza/finances-control/tree/main/docs/adr); as **locais do backend**, em [`adr/`](adr/).
