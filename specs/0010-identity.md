---
id: '0010'
title: Identity — usuários, autenticação e RBAC
status: approved
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
  endpoints de usuário; o email verificado e o re-vínculo por email; o projeto Firebase de `dev`;
  a foto do usuário, guardada no banco (revisão de 2026-10-13, FCB-022).
- **Fora de escopo:** cadastro, senha, reset e login social, que são do Firebase e do frontend — a
  plataforma não custodia credencial; permissões por recurso ou por registro (o RBAC aqui é por
  perfil, não por linha); convite de usuário por email; auditoria geral de ações, que é assunto de
  quem registra a ação; o spike do popup do Google em origem HTTP, que é da Fase 3 do roadmap; redimensionar ou
  recortar a foto no servidor (o frontend envia a imagem já pronta) e foto de outro usuário que
  não a própria, mesmo para o `ADMIN`.

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

### Projeto Firebase

A identidade de `dev` vive no projeto Firebase próprio da plataforma, o **`dev-financial-control`**,
por decisão do responsável em 2026-10-10
([ADR-0009](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0009-firebase-project.md)).
Ele substitui o `financial-control-472211`, que o `T-0010-06` usou. Em `dev`,
`FIREBASE_PROJECT_ID` vale `dev-financial-control`, e a service account do `firebase-admin` é
desse projeto. A chave continua no Secret Manager do `homelab-492918`, como versão 2 de
`homelab-dev-finances-firebase-service-account`.

Os UIDs mudam de um projeto para o outro, e quem já tem linha em `users` volta com outro UID e o
mesmo email. Isso se resolve pelo re-vínculo do provisionamento (INV-0010-11), sem script
de dados.

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
| `email_verified`     | `boolean`     | not null, default `false`, espelha a claim do último token          |
| `created_at`         | `timestamptz` | not null, `now()`                                                   |
| `updated_at`         | `timestamptz` | not null, `now()`, mantida pelo trigger `set_updated_at()`          |

`profile` nulo é o estado normal de quem acabou de se cadastrar — não é dado faltando.

Tabela `user_avatars`, uma linha por usuário que tem foto (revisão de 2026-10-13):

| Coluna         | Tipo          | Regra                                                                                     |
| -------------- | ------------- | ----------------------------------------------------------------------------------------- |
| `user_id`      | `uuid`        | PK, FK `users(id)` `on delete cascade`                                                    |
| `content`      | `bytea`       | not null, os bytes da imagem                                                              |
| `content_type` | `text`        | not null, `ck_user_avatars_content_type` limita a `image/jpeg`, `image/png`, `image/webp` |
| `size_bytes`   | `integer`     | not null, `ck_user_avatars_size_bytes` entre 1 e 524288                                   |
| `updated_at`   | `timestamptz` | not null, `now()`, mantida pelo trigger `set_updated_at()`                                |

A foto fica fora de `users` para que ler um usuário, o que acontece em toda requisição, não carregue
os bytes.

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
  `VerifiedToken = { uid: string; email: string; emailVerified: boolean; name: string | null }`,
  com `emailVerified` vindo da claim `email_verified` do token (ausente conta como `false`).
- Adaptador `FirebaseTokenVerifier` implementa a porta com `firebase-admin`, portando o padrão
  `verifyToken` do `control-backend`. É o único ponto do repositório que conhece `firebase-admin`.
- A porta existe para que todo o resto seja testável sem rede e sem projeto Firebase.

### Provisionamento no primeiro acesso

Não há endpoint de cadastro: o usuário nasce no Firebase, e o registro local aparece na primeira
requisição autenticada.

1. Token válido, nenhum `users.firebase_uid` correspondente e nenhum usuário com o mesmo email →
   cria o usuário com `profile` nulo.
2. Token válido, nenhum `users.firebase_uid` correspondente, mas já existe usuário com o mesmo email
   (normalizado) → **re-vínculo**: com `emailVerified` verdadeiro, o `firebase_uid` da linha
   existente passa a ser o do token, e o usuário mantém `id`, perfil e histórico. Com
   `emailVerified` falso, nada é gravado e a requisição recebe `ERR-0010-11`.
3. Se `IDENTITY_BOOTSTRAP_ADMIN_EMAIL` está definida, bate com o email do token **e**
   `emailVerified` é verdadeiro, o usuário é criado (ou promovido) com `profile = 'ADMIN'`,
   `profile_granted_by` nulo — concessão do sistema, não de uma pessoa. O mecanismo **só
   promove**: nunca rebaixa, e não faz nada se o usuário já é `ADMIN`. Com o email ainda não
   verificado, o usuário é criado ou mantido sem promoção, e a promoção acontece no primeiro
   acesso depois da verificação.
4. Usuário existente tem `email`, `name` e `email_verified` atualizados quando mudarem no Firebase.
   O `profile` **nunca** é tocado aqui, exceto pela promoção do item 3.

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
{ id, email, emailVerified, name, profile, profileGrantedAt, createdAt }
```

`emailVerified` deixa o Admin ver, na lista, quem ainda não confirmou o email antes de conceder um
perfil.

`PATCH` recebe `{ "profile": "ADMIN" | "BILLER" | "VIEWER" }`, validado por zod, e grava
`profile_granted_by` com o `id` de quem chamou. `GET /users/me` é o único acessível sem perfil — é
por ele que o frontend descobre que a conta está pendente.

Os quatro endpoints entram em `docs/openapi.yaml`, na tag `Identity`.

### Foto do usuário

Pedido do responsável nos testes em `dev` (2026-10-13): trocar o avatar com as iniciais por uma
foto. Por decisão do responsável, a foto fica no banco da plataforma, e não no Firebase Storage,
que exigiria ligar o faturamento no projeto `dev-financial-control`.

| Método   | Rota               | Quem pode       | O que faz                                   |
| -------- | ------------------ | --------------- | ------------------------------------------- |
| `PUT`    | `/users/me/avatar` | qualquer perfil | Envia ou troca a própria foto               |
| `DELETE` | `/users/me/avatar` | qualquer perfil | Remove a própria foto; sem foto, também 204 |
| `GET`    | `/users/me/avatar` | qualquer perfil | Devolve os bytes da própria foto            |

- **Envio:** o corpo é a imagem crua, com `Content-Type` `image/jpeg`, `image/png` ou
  `image/webp`, lido por `express.raw` só nessa rota, com limite de 524288 bytes (512 KiB). O
  serviço confere os primeiros bytes contra o tipo declarado (assinaturas JPEG `FF D8 FF`, PNG
  `89 50 4E 47 0D 0A 1A 0A` e WebP `RIFF....WEBP`) e grava ou substitui a linha de
  `user_avatars`. A resposta é `200` com o `UserResponse` atualizado.
- **Leitura:** `200` com os bytes, o `Content-Type` gravado, `Content-Length`,
  `X-Content-Type-Options: nosniff` e `Cache-Control: private, max-age=86400`. Sem foto, `404`.
  O frontend pede a foto com o token (uma `<img>` não envia o header) e acrescenta
  `?v=<avatarUpdatedAt>` à URL, que o backend ignora, para não ler uma foto velha do cache.
- **`UserResponse`** ganha `avatarUpdatedAt`: o `updated_at` da foto, ou `null` sem foto. É por ele
  que o frontend sabe se há foto e quando ela mudou, sem pedir os bytes.
- **Sem perfil:** as três rotas exigem um perfil, e assim `GET /users/me` continua sendo a única
  rota de quem está pendente (INV-0010-03).
- As três rotas entram em `docs/openapi.yaml`, na tag `Identity`, e na coleção do Postman.

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
- **INV-0010-06:** existe sempre ao menos um usuário com perfil `ADMIN` — a operação que
  deixaria a plataforma sem nenhum é recusada. A checagem vive no serviço, junto da escrita, e
  continua valendo se um dia surgir um endpoint administrativo, um script de manutenção ou a
  decisão de permitir autoalteração — momentos em que o `INV-0010-05` deixaria de proteger
  este caso por tabela.
  plataforma sem nenhum é recusada.
- **INV-0010-07:** `firebase-admin` é importado apenas pelo adaptador da porta `TokenVerifier`.
- **INV-0010-08:** email é persistido normalizado, e toda comparação usa a forma normalizada.
- **INV-0010-09:** o token não é registrado em log, nem inteiro nem em pedaço; o que se registra é o
  `userId` e o correlation-id.
- **INV-0010-10:** o bootstrap só promove quem tem email verificado no token. Um cadastro por email
  e senha com o email de bootstrap, ainda sem verificação, nunca vira `ADMIN`.
- **INV-0010-11:** uma linha de `users` só troca de `firebase_uid` por re-vínculo com email
  verificado. Um token sem email verificado nunca assume a linha de outro UID.
- **INV-0010-12:** só se grava foto JPEG, PNG ou WebP de até 524288 bytes, cujos primeiros bytes
  batem com o tipo declarado. SVG e qualquer outro tipo são recusados.
- **INV-0010-13:** um usuário só lê, troca e remove a própria foto; nenhuma rota recebe o id de
  outro usuário para isso.
- **INV-0010-14:** ler um usuário (`users`, `UserResponse`) nunca carrega os bytes da foto.

## Error cases

| Situação                                                                    | Comportamento exigido                                                                     |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **ERR-0010-01** `Authorization` ausente ou malformado                       | `401`, código `UNAUTHENTICATED`, mensagem sobre o header — nunca sobre o token            |
| **ERR-0010-02** Token inválido ou de outro projeto                          | `401`, código `UNAUTHENTICATED`; o motivo do Firebase vai para o log, não para a resposta |
| **ERR-0010-03** Token expirado                                              | `401`, código `TOKEN_EXPIRED` — distinto, porque o cliente resolve renovando              |
| **ERR-0010-04** Usuário autenticado sem perfil                              | `403`, código `PROFILE_PENDING`, com texto que explica que falta aprovação de um Admin    |
| **ERR-0010-05** Perfil insuficiente para a rota                             | `403`, código `FORBIDDEN`                                                                 |
| **ERR-0010-06** `PATCH`/`DELETE` sobre o próprio usuário                    | `409`, código `CANNOT_CHANGE_OWN_PROFILE` (INV-0010-05)                                   |
| **ERR-0010-07** Operação deixaria a plataforma sem `ADMIN`                  | `409`, código `LAST_ADMIN` (INV-0010-06)                                                  |
| **ERR-0010-08** `:id` inexistente                                           | `404`, código `USER_NOT_FOUND`                                                            |
| **ERR-0010-09** `profile` fora do enum                                      | `400`, `VALIDATION_ERROR` do handler global (spec 0002)                                   |
| **ERR-0010-10** Firebase indisponível                                       | `503`, código `AUTH_UNAVAILABLE`; falha de infraestrutura não vira `401`                  |
| **ERR-0010-11** Email de usuário existente, outro UID, email não verificado | `403`, código `EMAIL_NOT_VERIFIED`, com texto que pede a verificação do email             |
| **ERR-0010-12** Foto acima de 524288 bytes                                  | `413`, código `AVATAR_TOO_LARGE`, com o limite no texto; nada é gravado                   |
| **ERR-0010-13** Foto de tipo não aceito ou bytes que não batem com o tipo   | `415`, código `AVATAR_UNSUPPORTED_TYPE`, com os tipos aceitos no texto; nada é gravado    |
| **ERR-0010-14** `GET /users/me/avatar` sem foto                             | `404`, código `AVATAR_NOT_FOUND`                                                          |

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
- **AC-0010-10:** revogar ou rebaixar o perfil do único `ADMIN` restante recebe
  `409 LAST_ADMIN` e não altera o banco. **Pela API esse caminho não existe**: só um `ADMIN`
  alcança essas rotas e o `INV-0010-05` o impede de mirar em si mesmo, então sempre resta ao
  menos ele. A trava é defesa em profundidade e se verifica chamando `UserService` diretamente.
- **AC-0010-11:** emails que diferem só por maiúsculas e espaços resolvem para o mesmo usuário, e a
  segunda gravação viola `uq_users_email`.
- **AC-0010-12:** o gate `boundaries` reprova qualquer import de `firebase-admin` fora do adaptador.
- **AC-0010-13:** usuário criado a partir de um token sem display name fica com o email em `name`; e
  um nome já gravado não é substituído pelo email quando o token deixa de trazê-lo.
- **AC-0010-14:** com `IDENTITY_BOOTSTRAP_ADMIN_EMAIL` igual ao email do token e `emailVerified`
  falso, o primeiro acesso cria o usuário com `profile` nulo. O primeiro acesso com o email já
  verificado o promove a `ADMIN`.
- **AC-0010-15:** um token com UID novo, email de um usuário existente e `emailVerified` verdadeiro
  recebe `200` em `GET /users/me`. A resposta traz o mesmo `id` e o mesmo `profile` da linha
  existente, e a linha passa a ter o UID novo.
- **AC-0010-16:** o mesmo cenário com `emailVerified` falso recebe `403 EMAIL_NOT_VERIFIED`, e a
  linha existente não muda.
- **AC-0010-17:** `UserResponse` traz `emailVerified`, que acompanha a claim do último token do
  usuário. O contrato no `openapi.yaml` declara o campo.
- **AC-0010-18:** em `dev`, com `FIREBASE_PROJECT_ID=dev-financial-control`, um token emitido pelo
  projeto `dev-financial-control` recebe `200` em `GET /users/me`. Um token do projeto anterior recebe
  `401 UNAUTHENTICATED` (ERR-0010-02). A evidência vai colada no PR.

- **AC-0010-19:** `PUT /users/me/avatar` com um PNG válido de 10 KB responde `200`, com
  `avatarUpdatedAt` preenchido; `GET /users/me/avatar` devolve os mesmos bytes, com
  `Content-Type: image/png` e `X-Content-Type-Options: nosniff`; e `GET /users/me` traz o mesmo
  `avatarUpdatedAt`.
- **AC-0010-20:** um segundo `PUT` com um JPEG substitui a foto (uma linha só em `user_avatars`) e
  muda `avatarUpdatedAt`; `DELETE /users/me/avatar` responde `204`, `avatarUpdatedAt` volta a
  `null` e `GET /users/me/avatar` responde `404 AVATAR_NOT_FOUND`; um segundo `DELETE` também
  responde `204`.
- **AC-0010-21:** um corpo de 524289 bytes recebe `413 AVATAR_TOO_LARGE`; `Content-Type: image/svg+xml`
  e um texto enviado como `image/png` recebem `415 AVATAR_UNSUPPORTED_TYPE`; em nenhum dos casos
  `user_avatars` muda.
- **AC-0010-22:** usuário sem perfil recebe `403 PROFILE_PENDING` nas três rotas da foto; sem token,
  `401 UNAUTHENTICATED`.
- **AC-0010-23:** a consulta que provisiona e lê o usuário em cada requisição não seleciona
  `user_avatars.content`.

## Test mapping

| Item                                                        | Teste                                                                                   |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| AC-0010-01, ERR-0010-01..03, ERR-0010-10                    | `tests/identity/authentication.middleware.spec.ts` (verifier falso)                     |
| AC-0010-02, AC-0010-03, AC-0010-04, AC-0010-13, INV-0010-04 | `tests/integration/identity/provisioning.spec.ts`                                       |
| AC-0010-05, AC-0010-08, ERR-0010-04, ERR-0010-05            | `tests/identity/profile.guard.spec.ts`                                                  |
| AC-0010-06, AC-0010-07, ERR-0010-08                         | `tests/integration/identity/profile-grant.spec.ts`                                      |
| AC-0010-09, INV-0010-05                                     | `tests/integration/identity/profile-guardrails.spec.ts` (pelo HTTP)                     |
| AC-0010-10, INV-0010-06                                     | `tests/integration/identity/profile-guardrails.spec.ts` (pelo serviço)                  |
| AC-0010-11, INV-0010-08                                     | `tests/identity/email.normalization.spec.ts` e o teste de integração de provisionamento |
| AC-0010-12, INV-0010-07                                     | gate `boundaries` (regra nova em `.dependency-cruiser.cjs`)                             |
| INV-0010-01, INV-0010-02, INV-0010-03                       | `tests/integration/identity/authorization.spec.ts`                                      |
| INV-0010-09                                                 | `tests/identity/authentication.middleware.spec.ts` (logger espionado)                   |
| AC-0010-14, INV-0010-10                                     | `tests/integration/identity/provisioning.spec.ts`                                       |
| AC-0010-15, AC-0010-16, INV-0010-11, ERR-0010-11            | `tests/integration/identity/provisioning.spec.ts`                                       |
| AC-0010-17                                                  | `tests/integration/identity/profile-grant.spec.ts` e `tests/openapi.spec.ts`            |
| AC-0010-18                                                  | evidência manual no PR (`GET /users/me` em `dev`)                                       |
| AC-0010-19, AC-0010-20, ERR-0010-14, INV-0010-13            | `tests/integration/identity/avatar.spec.ts`                                             |
| AC-0010-21, ERR-0010-12, ERR-0010-13, INV-0010-12           | `tests/identity/avatar-signature.spec.ts` e `tests/integration/identity/avatar.spec.ts` |
| AC-0010-22                                                  | `tests/integration/identity/avatar.spec.ts`                                             |
| AC-0010-23, INV-0010-14                                     | `tests/integration/identity/avatar.spec.ts` (consulta espionada)                        |

## Open questions

Nenhuma.
