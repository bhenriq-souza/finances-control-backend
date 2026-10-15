---
id: '0003'
title: Escopo por espaço na aplicação, com FKs compostas e sem RLS
status: accepted
---

# ADR-0003 (local) — Escopo por espaço na aplicação, com FKs compostas e sem RLS

## Context

A spec `0021` faz de cada registro financeiro um registro de um **espaço**, e nenhuma rota pode
alcançar registro de outro espaço (INV-0021-03). O acesso a dados é misto: os módulos usam
repositórios e query builders do TypeORM, e o `reporting` agrega por SQL próprio. O pool de
conexões é compartilhado entre requisições, jobs e handlers de evento.

Um vazamento entre espaços costuma nascer de uma consulta nova que esqueceu o filtro. A decisão
precisa tornar esse esquecimento difícil de escrever e fácil de pegar.

## Decision

- **O escopo é imposto na aplicação.** O espaço vem de `workspace_members`, lido pela autenticação
  e guardado no `RequestStore`. Os serviços o leem por `RequestContext.requireWorkspaceId()`, que
  falha com `500 WORKSPACE_CONTEXT_MISSING` quando a rota não passou pela guarda. Toda consulta de
  tabela de domínio filtra por `workspace_id`, e toda escrita o grava.
- **Interfaces públicas entre módulos recebem o espaço por parâmetro**, para valer igual numa
  requisição, num job e num handler de evento. Jobs percorrem todos os espaços e herdam o espaço
  da linha de origem; handlers usam o `workspaceId` do envelope do evento.
- **O banco garante a coerência das referências.** Cada tabela referenciada ganha
  `UNIQUE (workspace_id, id)`, e as FKs entre tabelas do espaço são compostas. Uma despesa não
  aponta para o cartão de outro espaço nem com um bug no serviço.
- **Um teste varre as rotas registradas** (`tests/integration/isolation/routes.spec.ts`) com dois
  espaços. Rota nova sem caso na suíte faz o teste falhar.
- **Row Level Security do PostgreSQL fica de fora.**

## Consequences

- O filtro aparece em cada consulta, explícito e revisável no PR. O custo é repetição; o helper
  de escopo da plataforma reduz a repetição nos repositórios, e o SQL do `reporting` passa o
  parâmetro como qualquer outro.
- Um esquecimento numa leitura não quebra a integridade (as FKs cobrem as escritas), mas vazaria
  dado. Quem pega é a suíte por rota, que roda em todo PR pelo `npm run check`.
- Tirar o limite de um espaço por usuário (INV-0021-02) não muda o mecanismo: só a forma de o
  autenticador escolher o espaço da requisição.

## Alternatives considered

- **RLS do PostgreSQL.** É a defesa mais forte, mas exige `SET LOCAL app.workspace_id` em toda
  transação, num pool compartilhado com jobs que percorrem todos os espaços e precisariam de um
  papel que ignora a política. O TypeORM não abre transação em toda leitura, e um `SET` fora de
  transação vaza para a próxima requisição da mesma conexão. Pode entrar depois, como segunda
  camada, sem desfazer esta decisão.
- **Um schema ou um banco por espaço.** Isolamento físico, mas multiplica migrations, conexões e
  backups para um app de poucos usuários, e torna o catálogo global uma cópia por espaço.
- **`workspace_id` só nas tabelas raiz** (contas, cartões), com as filhas herdando por join. Menos
  colunas, mas toda consulta de despesa ou fatura precisaria do join para filtrar, e a FK
  composta não seria possível.
