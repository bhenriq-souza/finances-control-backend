# Specs

Specs normativas deste repositório. Processo, template e ciclo de vida em [0000](0000-spec-process.md).

Faixas: `0000`–`0009` processo e plataforma · `0010`+ domínio, na ordem dos requisitos de negócio.

| ID                                   | Título                                                             | Status      |
| ------------------------------------ | ------------------------------------------------------------------ | ----------- |
| [0000](0000-spec-process.md)         | Processo de specs e convenções                                     | approved    |
| [0001](0001-development-workflow.md) | Fluxo de desenvolvimento (branches, commits, pull requests)        | approved    |
| [0002](0002-quality-gates.md)        | Portões de qualidade e orquestrador único                          | approved    |
| [0003](0003-persistence.md)          | Persistência — PostgreSQL, TypeORM e migrations                    | implemented |
| [0004](0004-domain-events.md)        | Eventos de domínio — dispatcher in-process e publicação pós-commit | approved    |
| [0005](0005-http-platform.md)        | Plataforma HTTP — erros de protocolo, contrato de erros e /api     | draft       |
| [0010](0010-identity.md)             | Identity — usuários, autenticação e RBAC                           | approved    |
| [0011](0011-accounts.md)             | Accounts — bancos, contas bancárias e cartões de crédito           | implemented |
| [0012](0012-expenses.md)             | Expenses — despesas, tipos, parcelamento e status                  | approved    |
| [0013](0013-statements.md)           | Statements — faturas de cartão, estornos, fechamento e pagamento   | approved    |
| [0014](0014-earnings.md)             | Earnings — receitas, tipos e status                                | approved    |
| [0015](0015-reporting.md)            | Reporting — saldo realizado, saldo previsto e relatórios           | approved    |
| [0017](0017-jobs-and-recurrence.md)  | Jobs e recorrência — pg-boss, rotinas diárias e lançamentos fixos  | approved    |
| [0018](0018-transfers.md)            | Transfers — transferências entre contas próprias                   | approved    |

Specs de domínio planejadas (ainda não escritas): `0016` imports — **adiada** (FCB-013).

Decisões de arquitetura: as de **produto** vivem em [`docs/adr/` do hub](https://github.com/bhenriq-souza/finances-control/tree/main/docs/adr); as **locais do backend**, em [`adr/`](adr/).
