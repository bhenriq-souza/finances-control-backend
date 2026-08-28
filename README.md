# finances-control-backend

API backend da plataforma [Finances Control](https://github.com/bhenriq-souza/finances-control) — controle financeiro pessoal.

## Stack

Node 22 · TypeScript (strict) · Express 5 · tsyringe · zod · Winston · OpenAPI, com os pacotes [`@bhs-dev/typescript-common-{types,errors,env}`](https://github.com/bhenriq-souza/typescript-common-packages). Banco PostgreSQL 16 com TypeORM entra em FCB-006.

Decisões: [ADR-0002](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0002-backend.md) (stack) · [ADR-0003](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0003-architecture-style.md) (monolito modular) · [ADR-0004](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0004-database.md) (banco) · [ADR-0005](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0005-queue.md) (eventos e assíncrono).

## Rodando localmente

```bash
nvm use                      # Node 22.18
npm ci
cp .env.example .env.local   # ajuste se precisar
npm run start:local          # http://localhost:3000
```

- `GET /health` — liveness da aplicação
- `/docs` — Swagger UI a partir de `docs/openapi.yaml`

## Qualidade

Um comando só, o mesmo que o CI executa:

```bash
npm run check                    # formatação, lint, tipos, fronteiras, testes, audit, specs
npm run check -- --require-tools # modo estrito: gate ausente vira falha
```

Cada gate aparece como PASS, FAIL ou SKIP com motivo. Detalhes na [spec 0002](specs/0002-quality-gates.md).

## Organização do código

Módulos por contexto de negócio, com as camadas dentro de cada um — não camadas globais:

```
src/
├── platform/        # infra transversal: config, DI, logging, contexto, HTTP, health
├── identity/        # F001 — usuários e autenticação        (a criar)
├── accounts/        # F002 — bancos, contas e cartões        (a criar)
├── expenses/        # F003 — despesas                        (a criar)
├── statements/      # F004 — faturas                         (a criar)
├── earnings/        # F005 — receitas                        (a criar)
├── reporting/       # saldo previsto e relatórios            (a criar)
└── imports/         # importação CSV                         (a criar)
```

**Fronteiras são verificadas pelo gate `boundaries`**, não por disciplina: um módulo só é acessado pelo seu `index.ts`, módulos de domínio não dependem uns dos outros (`reporting` é a exceção, só leitura) e `platform` nunca depende de domínio.

## Deploy

Push em `develop` dispara `.github/workflows/deploy.yml`, que chama o workflow reutilizável do [homelab-gitops](https://github.com/bhenriq-souza/homelab-gitops):

```
push develop → build da imagem → Artifact Registry (tag sha-<commit> + latest)
             → commit da nova tag no homelab-gitops → Argo CD reconcilia → dev-apps
```

A aplicação responde em `finances.dev.homelab.local` (rede local, via Traefik). Mudanças só em documentação não disparam deploy. Também dá para acionar manualmente pelo `workflow_dispatch`, escolhendo o ambiente.

Autenticação sem chave estática: OIDC/Workload Identity Federation para o GCP, e uma deploy key SSH com escopo de um repositório para escrever no GitOps. Os três secrets necessários (`GCP_WIF_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `GITOPS_DEPLOY_KEY`) já estão configurados; o procedimento está em [`docs/app-onboarding.md`](https://github.com/bhenriq-souza/homelab-gitops/blob/main/docs/app-onboarding.md) do homelab-gitops.

## Como o trabalho é feito

Desenvolvimento **agentic-driven**: comportamento em `specs/`, fila em [`docs/backlog.md`](docs/backlog.md), uma tarefa = uma branch = um PR, merge sempre humano. Regras completas em [`AGENTS.md`](AGENTS.md); skills em `.claude/skills/` (`/new-spec`, `/implement-task`, `/check`, `/finish-task`).

Duas regras não-negociáveis do domínio:

1. **Invariantes financeiras resolvem-se na mesma transação** — saldo, limite disponível e geração de parcelas nunca dependem de processamento assíncrono.
2. **Dinheiro nunca é ponto flutuante** — `numeric` no banco, inteiro de centavos ou string decimal no código.

Branch padrão: `develop` (imagens dev); `main` promove para produção.
