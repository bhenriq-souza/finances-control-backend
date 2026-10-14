---
id: '0019'
title: Carga inicial — dados reais de prd a partir da planilha
status: draft
depends_on: ['0000', '0003', '0011', '0012', '0014', '0017']
---

# 0019 — Carga inicial

## Goal

Levar para `prd` os dados que o responsável reuniu na planilha `finances-control - carga inicial
prd` — bancos, contas com saldo, cartões, tipos de despesa, despesas fixas, compras parceladas que
ainda não acabaram, faturas fechadas e não pagas, e recebimentos que ainda vão entrar — sem
digitação e sem atalho por SQL. Ao final, um comando lê uma pasta com um CSV por aba, valida tudo
antes de gravar qualquer coisa, grava pelos mesmos serviços que a API usa, para que saldos,
séries e parcelas sigam as invariantes das specs `0011`, `0012`, `0014` e `0017`, e pode rodar de
novo sem duplicar o que já entrou. O formato das abas é também o rascunho do contrato da
importação por CSV (spec `0016`, adiada), sem antecipá-la.

## Scope / Non-goals

- **Em escopo:** o formato de cada CSV; a leitura e a validação de todas as abas, com o relatório
  de todos os erros de uma vez; o modo de simulação (`--dry-run`); a gravação pelos serviços de
  `accounts`, `expenses` e `earnings`; a chave natural que torna a carga repetível; o arquivamento
  dos tipos de despesa que não estão na planilha, por decisão do responsável em 2026-10-14; o
  comando `npm run load:initial`.
- **Fora de escopo:** a importação por CSV como funcionalidade do produto, com upload, job e tela
  (spec `0016`, FCB-013, adiada); ler a planilha direto do Google — os CSVs são exportados antes,
  e os dados nunca entram no repositório ([ADR-0011 do hub](https://github.com/bhenriq-souza/finances-control/blob/main/docs/adr/ADR-0011-prd-environment.md));
  despesas e receitas já liquidadas, que já estão no saldo das contas; transferências; faturas
  históricas; usuários, que nascem no primeiro login (spec `0010`); desfazer uma carga — o caminho
  é restaurar o backup tirado antes dela.

## Contracts

### Comando

```text
npm run load:initial -- --dir <pasta> [--dry-run]
```

- Lê `<pasta>/<aba>.csv` para cada aba abaixo. Um arquivo ausente é `ERR-0019-01`.
- Conecta pelo `DATABASE_URL` (spec `0003`) e só exige essa variável: a carga não verifica tokens,
  não abre porta HTTP e não inicia o worker de jobs. O resto do ambiente segue os defaults da
  spec `0003`.
- `--dry-run` valida e imprime o plano sem gravar nada.
- Sai com código `0` quando a validação passa e, sem `--dry-run`, a gravação termina; com `1` em
  qualquer erro.

**Onde mora:** `src/load/`, na camada de composição, ao lado de `src/container.ts` e de
`src/api.config.ts` — fora dos módulos de domínio, como a API, porque lê e grava em `accounts`,
`expenses` e `earnings`. Acessa cada módulo só pela sua interface pública (`index.ts`), sem
repositório nem entidade (ADR-0003, regras 1 e 2).

### Formato dos arquivos

- UTF-8, separador vírgula, aspas duplas segundo a RFC 4180, cabeçalho na primeira linha. Colunas
  são localizadas pelo nome do cabeçalho, em qualquer ordem; colunas desconhecidas são ignoradas.
- **Datas:** `AAAA-MM-DD`.
- **Valores:** reais com ponto decimal e até duas casas; vírgula como separador de milhar é aceita
  (`1,593.00`), porque é como a planilha exporta. A conversão para centavos é feita sobre o texto,
  nunca por ponto flutuante (INV-0000-04).
- **`importar`:** `sim` ou `não`. Linhas com `não` são lidas e ignoradas, e nenhuma referência pode
  apontar para elas.
- **Referências** são por nome, comparado depois de `trim`, com diferença de maiúsculas.
- `observacao` é texto livre; onde a tabela abaixo não a usa, é ignorada.

### Abas e mapeamento

| Arquivo                   | Colunas                                                                                                                                                                                             | Vira                                                                                                                                                                                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bancos.csv`              | `nome`, `codigo_febraban`, `importar`                                                                                                                                                               | banco (spec 0011): `name`, `febrabanCode`                                                                                                                                                                                                                                                         |
| `contas.csv`              | `banco`, `descricao`, `tipo`, `numero_conta`, `saldo_inicial`, `data_saldo`, `limite_cheque_especial`, `importar`                                                                                   | conta: `bankId` pelo nome do banco, `description`, `type` (`CHECKING`/`SAVINGS`/`INVESTMENT`), `accountNumber`, `openingBalanceCents`, `overdraftLimitCents` (vazio é `0`); `data_saldo` só é validada                                                                                            |
| `cartoes.csv`             | `banco`, `nome`, `limite`, `dia_fechamento`, `dia_vencimento`, `conta_pagadora`, `importar`                                                                                                         | cartão: `bankId`, `name`, `creditLimitCents`, `closingDay`, `dueDay`, `paymentBankAccountId` pela `descricao` da conta                                                                                                                                                                            |
| `tipos_despesa.csv`       | `nome`, `importar`                                                                                                                                                                                  | tipo de despesa (spec 0012)                                                                                                                                                                                                                                                                       |
| `despesas_fixas.csv`      | `descricao`, `tipo_despesa`, `valor`, `conta`, `cartao`, `proxima_data`, `data_fim`, `situacao`, `importar`, `observacao`                                                                           | despesa `FIXED` (specs 0012 e 0017): `amountCents`, `occurredOn = proxima_data`, `recurrenceEndsOn = data_fim` (vazio: série sem fim), `status = situacao`, `notes = observacao`                                                                                                                  |
| `despesas_parceladas.csv` | `descricao`, `tipo_despesa`, `valor_parcela`, `conta`, `cartao`, `data_proxima_parcela`, `parcela_proxima`, `parcelas_total`, `parcelas_restantes`, `importar`, `observacao`                        | com `parcelas_restantes ≥ 2`, despesa `INSTALLMENT` com `amountCents = valor_parcela × parcelas_restantes` e `installmentTotal = parcelas_restantes`; com `1`, despesa `VARIABLE` de `valor_parcela`; `occurredOn = data_proxima_parcela`, status `OPEN`                                          |
| `faturas_em_aberto.csv`   | `cartao`, `vencimento`, `valor`, `tipo_despesa`, `importar`, `observacao`                                                                                                                           | despesa `VARIABLE` na conta pagadora do cartão, `occurredOn = vencimento`, status `OPEN`                                                                                                                                                                                                          |
| `recebimentos.csv`        | `descricao`, `tipo_receita`, `ocorrencia`, `valor`, `conta`, `proxima_data`, `data_fim`, `parcela_proxima`, `parcelas_total`, `parcelas_restantes`, `situacao`, `pagante`, `importar`, `observacao` | receita (spec 0014) de `kind = ocorrencia`; `FIXED` e `VARIABLE` com `amountCents = valor`; `INSTALLMENT` com `amountCents = valor × parcelas_restantes` e `installmentTotal = parcelas_restantes`; `occurredOn = proxima_data`, `recurrenceEndsOn = data_fim` só em `FIXED`, `status = situacao` |

Regras de cada aba:

- **Despesas** preenchem `conta` **ou** `cartao`, nunca os dois e nunca nenhum (`ERR-0019-04`).
  `conta` aponta para `contas.descricao`; `cartao`, para `cartoes.nome`.
- **`situacao`** aceita `OPEN` e `FORECAST`, os status de criação das specs `0012` e `0014`.
- **Descrição das parceladas:** a numeração original é preservada, porque no sistema as parcelas
  do grupo recomeçam em 1: `"<descricao> (<parcela_proxima>–<parcelas_total>/<parcelas_total>)"`,
  por exemplo `Seguro Auto (3–10/10)`; com uma parcela só, `"<descricao> (<parcelas_total>/<parcelas_total>)"`.
  Vale para despesas e recebimentos parcelados.
- **Faturas em aberto** viram despesa da conta pagadora, não fatura do cartão: a fatura já fechou
  fora do sistema, e o que falta é a saída de caixa no vencimento. Descrição:
  `"Fatura <cartao> (vence <vencimento>)"`.
- **Receitas:** `notes` é o `pagante`, como a spec `0014` prevê para a coluna `Pagante`; com
  `observacao`, `"<pagante> — <observacao>"`. `tipo_receita` aponta para um tipo de receita **que
  já existe** no sistema; a carga não cria tipos de receita.
- **Tipos de despesa:** os da planilha com `importar = sim` que ainda não existem são criados; os
  que existem são reaproveitados (se arquivados, desarquivados). Todo tipo de despesa ativo que
  **não** está na planilha com `sim` é arquivado — inclusive os pré-definidos da spec `0012` —, e
  `tipo_despesa` de qualquer aba precisa estar na planilha com `sim`.

### Ordem de gravação

1. bancos; 2. contas; 3. cartões; 4. tipos de despesa (criar, desarquivar, arquivar); 5. despesas
   fixas; 6. despesas parceladas; 7. faturas em aberto; 8. recebimentos. Cada linha é uma chamada ao
   serviço do seu módulo, na transação que o serviço já abre; a carga não abre transação própria.

### Chave natural (repetição)

Antes de criar, a carga procura o registro pela chave abaixo. Se existe, a linha é contada como
"já existia" e nada é alterado nela.

| Registro          | Chave                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| banco             | `codigo_febraban`                                                                                    |
| conta             | banco + `numero_conta`                                                                               |
| cartão            | banco + `nome`                                                                                       |
| tipo de despesa   | nome, sem diferença de maiúsculas                                                                    |
| despesa e receita | descrição final (com a numeração) + conta ou cartão + `occurredOn` da primeira ocorrência ou parcela |

### Relatório

Ao final (e no `--dry-run`, como plano), uma linha por aba com `criados`, `já existiam`,
`ignorados (importar = não)` e, para tipos de despesa, `arquivados`; depois os avisos. Os erros de
validação saem todos juntos, cada um com arquivo, linha (contando o cabeçalho como 1), coluna e
código.

## Invariants

- **INV-0019-01:** nada é gravado se a validação de qualquer aba falhar: a validação lê e confere
  todas as abas e todas as referências antes da primeira escrita.
- **INV-0019-02:** toda escrita passa pelo serviço público do módulo dono (`BankService`,
  `BankAccountService`, `CreditCardService`, `ExpenseTypeService`, `ExpenseService`,
  `EarningService`); a carga não usa repositório, entidade nem SQL de outro módulo.
- **INV-0019-03:** rodar a carga duas vezes sobre os mesmos arquivos produz o mesmo banco que
  rodar uma vez: a segunda execução cria zero registros.
- **INV-0019-04:** valores monetários são convertidos de texto para centavos inteiros sem ponto
  flutuante, e o total de uma compra parcelada é exatamente `valor_parcela × parcelas_restantes`.
- **INV-0019-05:** logo após a carga, o saldo atual de cada conta criada é igual ao seu
  `saldo_inicial`, porque nenhuma despesa ou receita nasce liquidada.
- **INV-0019-06:** depois de uma carga sem `--dry-run`, os tipos de despesa ativos são exatamente
  os da planilha com `importar = sim`.
- **INV-0019-07:** os dados da carga não entram no repositório: testes usam arquivos fictícios, e
  nenhum CSV real é versionado.

## Error cases

Erros de validação são acumulados e impressos juntos; nenhum deles grava nada (INV-0019-01).

| Código      | Quando                                                                                                                                                                                              | Mensagem (forma)                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| ERR-0019-01 | arquivo de uma aba ausente, ou sem uma coluna do contrato                                                                                                                                           | `contas.csv: coluna numero_conta ausente`                           |
| ERR-0019-02 | valor fora do formato: data que não é `AAAA-MM-DD` válida, valor monetário inválido ou negativo, inteiro inválido, enum desconhecido, `importar` que não é `sim`/`não`                              | `despesas_fixas.csv:4 valor: "1.000,00" não é um valor válido`      |
| ERR-0019-03 | referência que não resolve: banco, conta, cartão ou tipo que não existe na planilha com `importar = sim`, ou tipo de receita que não existe no sistema                                              | `cartoes.csv:3 conta_pagadora: "Santander" não está em contas`      |
| ERR-0019-04 | despesa com `conta` e `cartao` preenchidos, ou com nenhum                                                                                                                                           | `despesas_fixas.csv:9: preencha conta ou cartao, não os dois`       |
| ERR-0019-05 | chave natural repetida dentro da mesma aba, ou `descricao` repetida em `contas`                                                                                                                     | `contas.csv:5 numero_conta: repetido na linha 4`                    |
| ERR-0019-06 | regra do contrato de criação que a planilha viola: campo obrigatório vazio, `parcelas_restantes` fora de 1..120, `data_fim` antes de `proxima_data`, `parcela_*` em receita que não é `INSTALLMENT` | `recebimentos.csv:3 parcelas_restantes: obrigatório em INSTALLMENT` |
| ERR-0019-07 | o serviço recusa uma linha durante a gravação (erro de domínio das specs `0011`–`0017`)                                                                                                             | `despesas_parceladas.csv:6: <código e mensagem do serviço>`         |

`ERR-0019-07` interrompe a carga na linha que falhou; o que já foi gravado permanece, e a próxima
execução continua a partir dali pela chave natural (INV-0019-03).

**Aviso** (não impede a carga): parcelada em que `parcela_proxima + parcelas_restantes − 1` difere
de `parcelas_total` — a planilha pode ter parcelas já quitadas fora de ordem, e o responsável
confere.

## Acceptance criteria

- **AC-0019-01:** com os arquivos fictícios completos, a carga cria bancos, contas, cartões, tipos,
  séries fixas, grupos de parcelas, faturas e receitas com os campos da tabela de mapeamento.
- **AC-0019-02:** um arquivo com erros em três abas diferentes produz os três erros no mesmo
  relatório, sai com código `1` e não grava nada (INV-0019-01).
- **AC-0019-03:** `--dry-run` imprime o plano com as mesmas contagens da execução real e não grava
  nada.
- **AC-0019-04:** a segunda execução sobre os mesmos arquivos termina com zero criados e tudo em
  "já existiam" (INV-0019-03).
- **AC-0019-05:** `1,593.00`, `1593.00`, `1593` e `0.62` viram `159300`, `159300`, `159300` e
  `62` centavos; `1.000,00` e `-5` são `ERR-0019-02` (INV-0019-04).
- **AC-0019-06:** uma parcelada com `parcelas_restantes = 1` vira uma despesa `VARIABLE`; com `≥ 2`,
  um grupo cuja soma é `valor_parcela × parcelas_restantes` e cuja descrição traz a numeração
  original.
- **AC-0019-07:** uma fatura em aberto vira despesa `VARIABLE` `OPEN` na conta pagadora do cartão,
  com data de vencimento.
- **AC-0019-08:** depois da carga, os tipos de despesa ativos são exatamente os da planilha com
  `sim`; um pré-definido ausente da planilha fica arquivado, e um presente é reaproveitado
  (INV-0019-06).
- **AC-0019-09:** depois da carga, o saldo de cada conta é o `saldo_inicial` (INV-0019-05).
- **AC-0019-10:** o comando roda só com `DATABASE_URL`, sem as variáveis do Firebase.
- **AC-0019-11:** a carga não importa repositório nem entidade de módulo de domínio: o gate
  `boundaries` (spec 0002) passa com `src/load/` importando apenas `index.ts` dos módulos
  (INV-0019-02).

## Test mapping

| Item                                               | Teste                                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| AC-0019-05, INV-0019-04                            | `tests/load/parse.spec.ts` (unitário: dinheiro, datas, CSV RFC 4180)                     |
| AC-0019-02, INV-0019-01, ERR-0019-01 a ERR-0019-06 | `tests/load/validate.spec.ts` (unitário, arquivos fictícios em memória)                  |
| AC-0019-01, AC-0019-06, AC-0019-07, AC-0019-08     | `tests/integration/load/initial-load.spec.ts` (banco real dos testes, spec 0003)         |
| AC-0019-03, AC-0019-04, INV-0019-03                | `tests/integration/load/initial-load.spec.ts`                                            |
| AC-0019-09, INV-0019-05, INV-0019-06               | `tests/integration/load/initial-load.spec.ts`                                            |
| ERR-0019-07                                        | `tests/integration/load/initial-load.spec.ts` (serviço recusa, rodada seguinte continua) |
| AC-0019-10                                         | `tests/integration/load/initial-load.spec.ts` (ambiente só com `DATABASE_URL`)           |
| AC-0019-11, INV-0019-02                            | gate `boundaries` (spec 0002)                                                            |
| INV-0019-07                                        | revisão em PR; fixtures em `tests/load/fixtures/` com dados fictícios                    |

## Open questions

- **Tipo das faturas em aberto.** A despesa que representa a fatura fechada precisa de um tipo, e o
  responsável decidiu manter em `prd` só os tipos da planilha. Proposta: a aba `faturas_em_aberto`
  ganha a coluna `tipo_despesa`, e o tipo `Cartão de Crédito` passa a `importar = sim` para essa
  linha.
