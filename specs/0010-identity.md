---
id: '0010'
title: Identity — usuários, autenticação e RBAC
status: implemented
depends_on: ['0000', '0003']
---

# 0010 — Identity

## Goal

Estabelecer quem é o autor de cada requisição e o que ele pode fazer. A identidade é delegada ao
Firebase ([ADR-0006](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0006-auth.md)):
o backend valida o ID token a cada chamada, mantém seu próprio registro de usuário vinculado ao UID,
e decide autorização por um perfil lido do banco — nunca do token. Ao final, qualquer módulo de
domínio pode exigir autenticação e um perfil sem conhecer o módulo `identity`, e um usuário novo não
enxerga dado financeiro nenhum até que um Admin decida o contrário.

## Scope / Non-goals

- **Em escopo:** verificação do ID token; criação do registro de usuário no primeiro acesso; o perfil
  único por usuário (`ADMIN`, `BILLER`, `VIEWER`) e sua concessão por um Admin; o bootstrap do
  primeiro Admin; o contrato que os demais módulos usam para exigir autenticação e perfil; os
  endpoints de usuário.
- **Fora de escopo:** cadastro, senha, reset e login social, que são do Firebase e do frontend — a
  plataforma não custodia credencial; permissões por recurso ou por registro (o RBAC aqui é por
  perfil, não por linha); convite de usuário por email; auditoria geral de ações, que é assunto de
  quem registra a ação; o spike do popup do Google em origem HTTP, que é da Fase 3 do roadmap.

## Contracts

### Dependências

`firebase-admin` como dependência de runtime.

### Variáveis de ambiente

Acrescentadas a `src/platform/config/env.list.ts`:

| Chave                            | Obrigatória | Default | Descrição                                                                 |
| -------------------------------- | ----------- | ------- | ------------------------------------------------------------------------- |
| `FIREBASE_PROJECT_ID`            | sim         | —       | Projeto Firebase que emite os tokens                                      |
| `FIREBASE_SERVICE_ACCOUNT`       | sim         | —       | Service account JSON do `firebase-admin`, em uma linha                    |
| `IDENTITY_BOOTSTRAP_ADMIN_EMAIL` | não         | —       | Email promovido a `ADMIN` no primeiro acesso; ausente desliga o bootstrap |

As duas primeiras chegam do GCP Secret Manager por ExternalSecret, na convenção
`homelab-{env}-finances-*` — nunca versionadas (INV-0003-07).

### Modelo

Tabela `users`, seguindo as convenções da [spec 0003](0003-persistence.md):

| Coluna               | Tipo          | Regra                                                               |
| -------------------- | ------------- | ------------------------------------------------------------------- |
| `id`                 | `uuid`        | PK, `gen_random_uuid()`                                             |
| `firebase_uid`       | `text`        | not null, único (`uq_users_firebase_uid`)                           |
| `email`              | `text`        | not null, único (`uq_users_email`), sempre normalizado              |
| `name`               | `text`        | not null                                                            |
| `profile`            | `text`        | **nullable**, `ck_users_profile` limita a `ADMIN`/`BILLER`/`VIEWER` |
| `profile_granted_at` | `timestamptz` | nullable, preenchida junto com `profile`                            |
| `profile_granted_by` | `uuid`        | nullable, FK `users(id)` `on delete restrict`                       |
| `created_at`         | `timestamptz` | not null, `now()`                                                   |
| `updated_at`         | `timestamptz` | not null, `now()`, mantida pelo trigger `set_updated_at()`          |

`profile` nulo é o estado normal de quem acabou de se cadastrar — não é dado faltando.

O perfil é **um só por usuário**, como no modelo de dados do produto: `ADMIN` não acumula `BILLER`,
concede a si mesmo o que precisar. O enum é `text` com CHECK, não tipo `enum` do PostgreSQL:
acrescentar um valor vira uma linha de migration em vez do ritual de `ALTER TYPE`, e o nome da
constraint segue a convenção da spec 0003. **Esta decisão vale como precedente** para os demais
enumerados do domínio (`EntryStatus`, tipos de conta, categorias).

### Normalização de email

`email` é gravado em minúsculas e sem espaços nas pontas. A comparação com
`IDENTITY_BOOTSTRAP_ADMIN_EMAIL` usa a mesma normalização dos dois lados. Não há índice funcional:
normaliza-se na escrita, e a unicidade é constraint comum.

### Verificação do token

- Porta `TokenVerifier` em `src/identity/`, com um único método
  `verify(idToken: string): Promise<VerifiedToken>`, onde
  `VerifiedToken = { uid: string; email: string; name: string | null }`.
- Adaptador `FirebaseTokenVerifier` implementa a porta com `firebase-admin`, portando o padrão
  `verifyToken` do `control-backend`. É o único ponto do repositório que conhece `firebase-admin`.
- A porta existe para que todo o resto seja testável sem rede e sem projeto Firebase.

### Provisionamento no primeiro acesso

Não há endpoint de cadastro: o usuário nasce no Firebase, e o registro local aparece na primeira
requisição autenticada.

1. Token válido, nenhum `users.firebase_uid` correspondente → cria o usuário com `profile` nulo.
2. Se `IDENTITY_BOOTSTRAP_ADMIN_EMAIL` está definida e bate com o email do token, o usuário é criado
   (ou promovido) com `profile = 'ADMIN'`, `profile_granted_by` nulo — concessão do sistema, não de
   uma pessoa. O mecanismo **só promove**: nunca rebaixa, e não faz nada se o usuário já é `ADMIN`.
3. Usuário existente tem `email` e `name` atualizados quando mudarem no Firebase. O `profile`
   **nunca** é tocado aqui.

Tudo isso numa única transação por requisição.

#### Nome de exibição

`users.name` é `not null`, e o Firebase **não** obriga display name — quem se cadastra com email e
senha costuma não ter nenhum. Na criação do registro, o email entra no lugar: é um marcador honesto,
melhor do que inventar um nome ou tornar a coluna opcional por causa de um caso de borda.

Um nome de verdade, uma vez gravado, nunca volta a ser o email: se o token deixar de trazer nome, o
que já está no banco permanece.

### Middlewares

Publicados pela interface do módulo e aplicados por cada rota que os exigir:

- `requireAuthentication` — lê `Authorization: Bearer <idToken>`, verifica, provisiona e grava o
  usuário no contexto da requisição.
- `requireProfile(...profiles)` — exige que o usuário no contexto tenha um dos perfis. Sem perfil é
  `ERR-0010-04`, e não uma negativa genérica.

O usuário autenticado viaja no `RequestContext` da plataforma, que ganha os campos opcionais
`userId: string` e `userProfile: UserProfile | null` no `RequestStore`. São dados simples, não uma
entidade: `platform` continua sem conhecer o módulo `identity` (INV-0003-09).

### Endpoints

Prefixo `/users`, registrado em `api.config.ts`.

| Método   | Rota                 | Quem pode   | O que faz                                                |
| -------- | -------------------- | ----------- | -------------------------------------------------------- |
| `GET`    | `/users/me`          | autenticado | Devolve o próprio usuário, inclusive sem perfil          |
| `GET`    | `/users`             | `ADMIN`     | Lista os usuários, ordenados por `created_at`            |
| `PATCH`  | `/users/:id/profile` | `ADMIN`     | Concede ou troca o perfil de outro usuário               |
| `DELETE` | `/users/:id/profile` | `ADMIN`     | Revoga o perfil, devolvendo o usuário ao estado pendente |

`UserResponse`, em todos eles:

```
{ id, email, name, profile, profileGrantedAt, createdAt }
```

`PATCH` recebe `{ "profile": "ADMIN" | "BILLER" | "VIEWER" }`, validado por zod, e grava
`profile_granted_by` com o `id` de quem chamou. `GET /users/me` é o único acessível sem perfil — é
por ele que o frontend descobre que a conta está pendente.

Os quatro endpoints entram em `docs/openapi.yaml`, na tag `Identity`.

## Invariants

- **INV-0010-01:** nenhuma rota de domínio responde sem um ID token válido; a única exceção do
  repositório é `/health` e `/health/ready` (spec 0003).
- **INV-0010-02:** o perfil que decide autorização é sempre o da linha em `users`, lido na
  requisição — nunca um custom claim do token.
- **INV-0010-03:** usuário sem perfil não acessa recurso de domínio algum, e `GET /users/me` é a
  única rota que ele alcança.
- **INV-0010-04:** o bootstrap só promove: nunca rebaixa um perfil existente nem revoga.
- **INV-0010-05:** um `ADMIN` não altera nem revoga o próprio perfil; a mudança parte sempre de outro
  `ADMIN`.
- **INV-0010-06:** existe sempre ao menos um usuário com perfil `ADMIN` — a operação que deixaria a
  plataforma sem nenhum é recusada.
- **INV-0010-07:** `firebase-admin` é importado apenas pelo adaptador da porta `TokenVerifier`.
- **INV-0010-08:** email é persistido normalizado, e toda comparação usa a forma normalizada.
- **INV-0010-09:** o token não é registrado em log, nem inteiro nem em pedaço; o que se registra é o
  `userId` e o correlation-id.

## Error cases

| Situação                                                   | Comportamento exigido                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **ERR-0010-01** `Authorization` ausente ou malformado      | `401`, código `UNAUTHENTICATED`, mensagem sobre o header — nunca sobre o token            |
| **ERR-0010-02** Token inválido ou de outro projeto         | `401`, código `UNAUTHENTICATED`; o motivo do Firebase vai para o log, não para a resposta |
| **ERR-0010-03** Token expirado                             | `401`, código `TOKEN_EXPIRED` — distinto, porque o cliente resolve renovando              |
| **ERR-0010-04** Usuário autenticado sem perfil             | `403`, código `PROFILE_PENDING`, com texto que explica que falta aprovação de um Admin    |
| **ERR-0010-05** Perfil insuficiente para a rota            | `403`, código `FORBIDDEN`                                                                 |
| **ERR-0010-06** `PATCH`/`DELETE` sobre o próprio usuário   | `409`, código `CANNOT_CHANGE_OWN_PROFILE` (INV-0010-05)                                   |
| **ERR-0010-07** Operação deixaria a plataforma sem `ADMIN` | `409`, código `LAST_ADMIN` (INV-0010-06)                                                  |
| **ERR-0010-08** `:id` inexistente                          | `404`, código `USER_NOT_FOUND`                                                            |
| **ERR-0010-09** `profile` fora do enum                     | `400`, `VALIDATION_ERROR` do handler global (spec 0002)                                   |
| **ERR-0010-10** Firebase indisponível                      | `503`, código `AUTH_UNAVAILABLE`; falha de infraestrutura não vira `401`                  |

## Acceptance criteria

- **AC-0010-01:** requisição sem header, com token inválido e com token expirado recebem
  respectivamente `UNAUTHENTICATED`, `UNAUTHENTICATED` e `TOKEN_EXPIRED`, todos `401`.
- **AC-0010-02:** primeiro acesso com token válido cria a linha em `users` com `profile` nulo, e um
  segundo acesso do mesmo UID não cria outra.
- **AC-0010-03:** com `IDENTITY_BOOTSTRAP_ADMIN_EMAIL` igual ao email do token, o primeiro acesso
  resulta em `profile = 'ADMIN'` e `profile_granted_by` nulo; repetir o acesso não muda nada.
- **AC-0010-04:** o bootstrap não rebaixa: um usuário já `ADMIN` por concessão humana continua com
  `profile_granted_by` preenchido.
- **AC-0010-05:** `GET /users/me` responde `200` para usuário sem perfil, e qualquer rota protegida
  por `requireProfile` responde `403 PROFILE_PENDING` para o mesmo usuário.
- **AC-0010-06:** `PATCH /users/:id/profile` como `ADMIN` grava perfil, `profile_granted_at` e
  `profile_granted_by`, e o novo perfil vale na requisição seguinte do alvo, sem troca de token.
- **AC-0010-07:** `DELETE /users/:id/profile` devolve o alvo ao estado pendente, e ele passa a
  receber `403 PROFILE_PENDING`.
- **AC-0010-08:** `BILLER` e `VIEWER` recebem `403 FORBIDDEN` em `GET /users` e em
  `PATCH /users/:id/profile`.
- **AC-0010-09:** um `ADMIN` que tenta alterar o próprio perfil recebe `409 CANNOT_CHANGE_OWN_PROFILE`.
- **AC-0010-10:** revogar o perfil do único `ADMIN` restante recebe `409 LAST_ADMIN` e não altera o banco.
- **AC-0010-11:** emails que diferem só por maiúsculas e espaços resolvem para o mesmo usuário, e a
  segunda gravação viola `uq_users_email`.
- **AC-0010-12:** o gate `boundaries` reprova qualquer import de `firebase-admin` fora do adaptador.
- **AC-0010-13:** usuário criado a partir de um token sem display name fica com o email em `name`; e
  um nome já gravado não é substituído pelo email quando o token deixa de trazê-lo.

## Test mapping

| Item                                                        | Teste                                                                                   |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| AC-0010-01, ERR-0010-01..03, ERR-0010-10                    | `tests/identity/authentication.middleware.spec.ts` (verifier falso)                     |
| AC-0010-02, AC-0010-03, AC-0010-04, AC-0010-13, INV-0010-04 | `tests/integration/identity/provisioning.spec.ts`                                       |
| AC-0010-05, AC-0010-08, ERR-0010-04, ERR-0010-05            | `tests/identity/profile.guard.spec.ts`                                                  |
| AC-0010-06, AC-0010-07, ERR-0010-08                         | `tests/integration/identity/profile-grant.spec.ts`                                      |
| AC-0010-09, AC-0010-10, INV-0010-05, INV-0010-06            | `tests/integration/identity/profile-guardrails.spec.ts`                                 |
| AC-0010-11, INV-0010-08                                     | `tests/identity/email.normalization.spec.ts` e o teste de integração de provisionamento |
| AC-0010-12, INV-0010-07                                     | gate `boundaries` (regra nova em `.dependency-cruiser.cjs`)                             |
| INV-0010-01, INV-0010-02, INV-0010-03                       | `tests/integration/identity/authorization.spec.ts`                                      |
| INV-0010-09                                                 | `tests/identity/authentication.middleware.spec.ts` (logger espionado)                   |

## Open questions

Nenhuma.
