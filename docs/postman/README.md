# Postman

Collection e ambientes para testar a API à mão. Tudo aqui é **gerado** de
[`docs/openapi.yaml`](../openapi.yaml) por [`scripts/postman.mjs`](../../scripts/postman.mjs):

| Arquivo                                    | O que é                                                    |
| ------------------------------------------ | ---------------------------------------------------------- |
| `finances-control.postman_collection.json` | Uma requisição por operação do contrato, em pastas por tag |
| `local.postman_environment.json`           | `baseUrl` = `http://localhost:3000`                        |
| `dev.postman_environment.json`             | `baseUrl` = `http://finances.dev.homelab.local`            |

Não edite os arquivos à mão. Mudou o contrato, rode `npm run postman` e commite o resultado. O teste
`tests/postman.spec.ts` falha se a collection estiver defasada em relação ao `openapi.yaml`.

## Preparar

1. No Postman, importe os três arquivos (_Import_ → arraste a pasta `docs/postman/`).
2. Escolha o ambiente (`local` ou `dev`) e preencha, em _Current value_:
    - `firebaseApiKey`: a chave de API da Web do projeto Firebase `financial-control-472211`
      (console do Firebase → Configurações do projeto → Geral → Chave de API da Web);
    - `email` e `password`: um usuário do provedor email/senha do Firebase Authentication.
3. Não exporte o ambiente preenchido de volta para o repositório: a senha e o token ficariam no
   Git. Os arquivos versionados saem sempre com esses campos vazios.

`dev` só responde de dentro da rede de casa, com `finances.dev.homelab.local` resolvendo para o
ingress do cluster. Local e dev usam o mesmo projeto Firebase; só o `baseUrl` muda.

## Autenticação

A collection inteira usa `Bearer {{idToken}}`. O script de pré-requisição da collection obtém o ID
token pelo `signInWithPassword` do Firebase com `email` e `password`, guarda em `idToken` e o
reaproveita até um minuto antes de expirar (uma hora). As duas rotas de saúde não usam token.

Não há cadastro na API: o usuário nasce no Firebase e o registro local aparece na primeira
requisição autenticada, **sem perfil** (spec 0010). Por isso:

- comece por `GET /users/me`;
- sem perfil, as demais rotas respondem `403 PROFILE_PENDING`;
- o email configurado em `IDENTITY_BOOTSTRAP_ADMIN_EMAIL` vira `ADMIN` no primeiro acesso; os outros
  usuários recebem perfil de um Admin, por `PATCH /users/:id/profile`.

## Variáveis

| Variável                                                                                                                                                   | Preenchida por                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `today`, `currentMonth`                                                                                                                                    | Pré-requisição, no fuso `America/Sao_Paulo` (`YYYY-MM-DD` e `YYYY-MM`) |
| `idToken`                                                                                                                                                  | Pré-requisição                                                         |
| `bankId`, `bankAccountId`, `creditCardId`, `expenseTypeId`, `earningTypeId`, `expenseId`, `earningId`, `bankTransferId`, `creditCardRefundId`, `paymentId` | O `POST` que cria o recurso, a partir de `data.id` da resposta `201`   |
| `toBankAccountId`                                                                                                                                          | À mão: a conta de destino de uma transferência, diferente da origem    |
| `userId`, `statementId`, `expenseRecurrenceId`, `earningRecurrenceId`, `installmentGroupId`                                                                | À mão, copiando de uma resposta                                        |

Os corpos de exemplo trazem só os campos obrigatórios (nos `PATCH`, um campo só); os opcionais estão
listados na descrição de cada requisição. Os parâmetros de query opcionais vêm desligados.

Um caminho que exercita quase tudo: `POST /banks` → `POST /bank-accounts` → `POST /expense-types` e
`POST /earning-types` → `POST /expenses` e `POST /earnings` → `POST /credit-cards` → relatórios.
