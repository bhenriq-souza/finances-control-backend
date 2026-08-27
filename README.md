# finances-control-backend

API backend da plataforma [Finances Control](https://github.com/bhenriq-souza/finances-control) — controle financeiro pessoal.

## Status

🚧 **Fase 0** — repositório criado, aguardando seed do kit agentic-driven (FCB-001) e scaffold do app (FCB-002). Acompanhe o [roadmap](https://github.com/bhenriq-souza/finances-control/blob/main/docs/roadmap.md) e o [backlog](https://github.com/bhenriq-souza/finances-control/blob/main/docs/backlog.md) no hub.

## Stack decidida ([ADR-0002](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0002-backend.md), [ADR-0004](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0004-database.md))

- Node.js + TypeScript, Express 5, contrato OpenAPI
- DI com tsyringe, validação com zod
- PostgreSQL 16 (cluster K3s homelab) + TypeORM com migrations
- Pacotes [`@bhs-dev/*`](https://github.com/bhenriq-souza/typescript-common-packages) (`types`, `errors`, `env`)
- Padrão de projeto semeado do template `ts-express-app`
- Deploy: Docker → GitHub Actions (WIF/OIDC) → GCP Artifact Registry → Argo CD ([homelab-gitops](https://github.com/bhenriq-souza/homelab-gitops))

## Método de trabalho

Desenvolvimento **agentic-driven**: specs normativas em `specs/`, fila de trabalho em `docs/backlog.md`, 1 tarefa = 1 branch = 1 PR, merge sempre humano. O manual completo estará em `AGENTS.md` após o seed (FCB-001).

- Branch padrão: `develop` (imagens dev); `main` promove para prd.
