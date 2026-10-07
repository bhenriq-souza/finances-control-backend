# Execução paralela com subagentes

Como o líder (a sessão principal) distribui tarefas independentes do backlog entre subagentes, cada
um num git worktree próprio, sem mudar o ciclo por tarefa nem os papéis da spec 0001: cada tarefa
continua sendo uma branch e um PR, e o merge continua humano.

Estado: **experimental**. As regras abaixo saíram das rodadas medidas no fim deste documento e
mudam a cada rodada nova.

## Quando uma tarefa pode ir para um subagente

Todos os critérios valem ao mesmo tempo:

1. A tarefa está em `docs/backlog.md` e a spec dela está `approved`. Escrever ou aprovar spec é
   decisão de domínio e fica fora do paralelismo.
2. Nenhuma tarefa da rodada está na cadeia de dependência de outra, e nenhuma depende de PR ainda
   não mergeado. A dependência declarada no texto de uma seção do backlog vale só para as tarefas
   que de fato usam o que ela cita (por exemplo, "depende da spec 0004" não segura uma tarefa só de
   schema). Na dúvida, o líder pergunta antes de lançar.
3. Módulos disjuntos em `src/` (ADR-0003, regras 1–3). Arquivo em comum é aceito só quando a
   mudança é **apenas acréscimo** (linhas de `export`, um `it(...)` novo no fim de uma suíte, o
   checkbox do backlog). O líder resolve esses conflitos no rebase, na ordem de merge. Duas tarefas
   que editam o mesmo trecho, a mesma migration ou a mesma tabela não são independentes.
4. É código e teste. Infra, CI, Firebase, documentação e spec ficam com o líder.

## Papéis

| Líder                                                                       | Subagente                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Escolhe as tarefas, pergunta ao responsável as ambiguidades antes de lançar | Implementa uma tarefa, exatamente os contratos da spec             |
| Move as issues para _In Progress_ no board                                  | Escreve os testes mapeados                                         |
| Escreve o briefing com caminhos exatos                                      | Roda os gates permitidos e commita                                 |
| Revisa o diff contra a spec                                                 | **Para no commit**: sem push, sem PR                               |
| Roda `npm run check`, faz push e abre o PR                                  | Em dúvida concreta, para e devolve a pergunta com as duas leituras |
| Remove o worktree quando ele não é mais necessário                          | Nunca fala com o responsável diretamente                           |

O líder abre os PRs porque devolver a tarefa ao subagente só para isso custa quase o mesmo que a
implementação: ele relê o contexto inteiro (rodada 1, abaixo).

## Worktrees

- Cada subagente roda em worktree próprio (`isolation: "worktree"`), criado em `.claude/worktrees/`.
  Dois agentes nunca dividem um working tree.
- **Ritual de branch no worktree.** `develop` já está em uso no working tree principal, então
  `git checkout develop` falha. O equivalente é:

    ```bash
    git fetch origin && git checkout -b <tipo>/<task-id>-<slug> origin/develop
    ```

- O worktree nasce sem `node_modules`. Basta um symlink para o do working tree principal, que nunca
  é commitado:

    ```bash
    ln -s <repo>/node_modules node_modules
    ```

- **Tarefa que acrescenta dependência** não pode instalar pelo symlink: o `npm install` alteraria o
  `node_modules` do working tree principal, compartilhado por todos. O subagente remove o symlink,
  roda `npm ci` e então `npm install <pacote>` no próprio worktree. Depois do merge, o líder roda
  `npm ci` no working tree principal antes da rodada seguinte.
- Pelo symlink, o dependency-cruiser resolve pacotes como `../../../node_modules/<pacote>/...`.
  Regra de fronteira sobre pacote usa `(^|/)node_modules/<pacote>/`, nunca `^<pacote>` nem
  `^node_modules/`, e é verificada com uma violação temporária num worktree.
- `.claude/worktrees/` é ignorado pelo Git, pelo ESLint e pelo Prettier. Sem isso, o `npm run check`
  do working tree principal reprovava o gate `lint` com os arquivos dos worktrees.
- **Limpeza é obrigatória** assim que o worktree deixa de ser necessário (PR mergeado ou tarefa
  descartada): `git worktree remove --force <caminho>`, `git worktree prune` e remoção das branches
  locais já mergeadas, incluindo as `worktree-agent-*`.

## Gates e banco de teste

Os testes de integração usam PostgreSQL real. Cada suíte já se isola num schema próprio
(`createIsolatedDataSource`), mas o nome do schema é fixo por suíte: dois worktrees rodando a mesma
suíte no mesmo banco se atropelam. Há dois modos.

- **Serial (padrão).** O subagente roda só o que não toca o banco: `npx jest <testes de unidade>`,
  `npx tsc --noEmit`, `npx eslint src tests`, `npx prettier --check .` e `npx depcruise src`. O líder
  roda `npm run check` completo, um worktree por vez. Com três tarefas isso já vira o gargalo, e cada
  rebase repete o `/check`.
- **Um banco por worktree.** `docker-compose.test.yml` aceita `TEST_DB_PORT` e `TEST_DB_SUFFIX`.
  Cada subagente sobe a sua instância, roda o `npm run check` completo e derruba ao final. Sem as
  variáveis, o padrão continua `finances-test-db` na porta 5433.

    ```bash
    export TEST_DB_PORT=5434 TEST_DB_SUFFIX=-5434   # 5434, 5435, ... um por subagente
    docker compose -p fc-test-$TEST_DB_PORT -f docker-compose.test.yml up -d --wait
    DATABASE_URL=postgres://finances_test@localhost:$TEST_DB_PORT/finances_test npm run check
    docker compose -p fc-test-$TEST_DB_PORT -f docker-compose.test.yml down -v
    ```

Mesmo no segundo modo, o líder roda o `/check` de novo depois de cada rebase, antes de atualizar o
PR.

## Board e issues

Cada tarefa aberta já tem a sua issue (spec 0000). Ao lançar a rodada, o líder move para
_In Progress_ a issue de cada tarefa e a `FCB-*` da spec, se ela ainda estiver em _Todo_. O PR traz
`Closes #N` da issue da tarefa. A `FCB-*` só fecha no PR da última tarefa da spec.

## Briefing do subagente

Curto e com caminhos exatos, para que o subagente não explore o repositório à toa:

- ID da tarefa, número da issue e linhas da tarefa em `docs/backlog.md`;
- caminho da spec e as seções relevantes **com o número das linhas**, mais o que fica fora (tarefas
  vizinhas);
- o que já foi mergeado e deve ser reaproveitado;
- quando duas tarefas da rodada constroem peças irmãs (os tipos de despesa e de receita, por
  exemplo), o **arquivo de referência** cuja convenção as duas seguem, para os detalhes que a spec
  não fixa (tamanho de campo, corpo de `PATCH`), e a resposta provisória para o que a spec deixa
  a uma tarefa futura (status e código de erro);
- os **pontos de parada previstos**: o que, se acontecer, faz o subagente parar e reportar em vez
  de contornar (arquivo fora da lista, mudança de gate, CI);
- arquivos que **pode** tocar, com a regra de só-acréscimo para os compartilhados;
- arquivos **proibidos**;
- o ritual de branch e o `node_modules` do worktree;
- os comandos de verificação permitidos e o modo de banco da rodada;
- o formato do commit, com rodapé `Task:` e a linha `Co-Authored-By` do modelo usado. A mensagem
  vai num arquivo **do próprio worktree**, no diretório Git dele, que nunca é commitado
  (`git commit -F "$(git rev-parse --git-dir)/COMMIT_DRAFT"`), e nunca num caminho comum como
  `/tmp/commit-msg`. O líder confere `git log -1` antes de abrir o PR;
- as regras duras: nunca merge, push em `develop`, `--no-verify`, gate afrouxado ou saída de teste
  inventada;
- o relatório final: branch e hash, arquivos, `AC`/`INV`/`ERR` → nome do teste, saída real dos
  comandos e perguntas em aberto.

Modelo: `sonnet` para tarefa com spec fechada (o padrão). `haiku` só para levantamento read-only.
Tarefa que exige decisão de design não deveria estar paralelizada.

**Tarefa que é a primeira do seu tipo** costuma esbarrar no ferramental, mesmo com spec fechada: o
primeiro import entre módulos de domínio, a primeira dependência nova, o primeiro pacote só ESM.
Antes de lançar, o líder confere o caminho mais curto (um import de teste no `depcruise`, o `type`
do pacote no `package.json`). Se a conferência falhar, ele resolve antes ou avisa no briefing que o
subagente vai parar ali.

**Permissão negada a um subagente** (o modo automático recusa um comando) é uma parada como as
outras: o líder não executa o comando no lugar dele, leva a decisão ao responsável e só então
conclui a tarefa ou a devolve ao subagente.

**Teste de concorrência** (várias transações disputando a mesma linha) leva timeout explícito no
próprio `it`. Com outros `/check` rodando em paralelo, ele passa do padrão de 5 s do Jest sem que
haja defeito.

## Rodadas medidas

| Rodada | Data       | Tarefas                                               | Modelo | Tokens por subagente                                                                                                                                                | Duração do subagente                                        |
| ------ | ---------- | ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1      | 2026-10-06 | T-0004-01, T-0012-03                                  | sonnet | ~51 mil e ~57 mil na implementação, mais ~55 mil e ~61 mil para push e PR                                                                                           | ~1–1,5 min                                                  |
| 2      | 2026-10-06 | T-0004-02, T-0012-01, T-0014-01                       | sonnet | ~59 mil, ~74 mil e ~72 mil                                                                                                                                          | ~1,5–2,5 min                                                |
| 3      | 2026-10-06 | T-0004-03, T-0012-02, T-0014-02, T-0013-01, T-0017-01 | sonnet | ~53 mil, ~81 mil, ~77 mil, ~88 mil e ~136 mil na primeira entrega; acumulado depois das retomadas: ~83 mil (T-0012-02), ~108 mil (T-0013-01) e ~149 mil (T-0017-01) | ~1,7–8,1 min na primeira entrega; ~0,8–3,6 min por retomada |
| 4      | 2026-10-07 | T-0002-01, T-0012-04, T-0014-03, T-0018-01            | sonnet | ~61 mil, ~122 mil, ~115 mil e ~129 mil na primeira entrega; acumulado depois das retomadas: ~120 mil (T-0014-03) e ~134 mil (T-0018-01)                             | ~3,2–5,7 min na primeira entrega; ~1,0–1,5 min por retomada |

Nas rodadas 1 e 2, nenhum subagente parou com dúvida sobre a spec e todos os `npm run check` saíram
verdes na primeira tentativa. Os subagentes tomaram decisões dentro da spec (proteção com
`RangeError`, formato de retorno de `businessToday`, FK só na migration), e o líder as conferiu
antes do PR.

Na rodada 3, a primeira com cinco subagentes e um banco por worktree, três das cinco tarefas
voltaram ao subagente:

- **T-0012-02**, uma vez, por revisão do líder: o subagente escolheu limites diferentes da tarefa
  irmã T-0014-02 e da convenção do `accounts`.
- **T-0013-01**, parada no gate `boundaries`: a regra proibia o import de `accounts` que a spec
  0013 exige. O responsável decidiu por uma allowlist num PR de gate próprio (#110) e por uma suíte
  de schema por módulo para a cobertura.
- **T-0017-01**, parada em arquivos fora da lista: o `pg-boss` é só ESM, o que pediu
  `jest.config.ts`, e o boot pedia `server.ts`. O responsável decidiu os dois.

Nenhuma parada foi improviso: todas chegaram ao líder com as leituras possíveis. O custo da rodada,
medido no `/usage`, foi de US$ 9,32: US$ 5,52 nos cinco subagentes (Sonnet) e US$ 3,80 no líder
(Opus). Foram ~35 min de relógio, 2% → 8% da janela de sessão do plano Max. O contexto do líder
terminou em ~190 mil tokens.

Na rodada 4, com quatro subagentes, o PR de gate (#116, `earnings` na allowlist do `accounts`) foi
mergeado antes do lançamento, e nenhuma tarefa parou em gate ou em arquivo fora da lista. Os quatro
entregaram em ~11 min de relógio, e três PRs estavam abertos ~24 min depois do lançamento. Duas
tarefas voltaram ao subagente:

- **T-0014-03**, uma vez: para `INSTALLMENT`, ainda sem implementação, ela respondia 501 com um
  código inventado, e a irmã T-0012-04 respondia 400 citando `kind`. O responsável escolheu o 400.
- **T-0018-01**, uma vez: o `/check` do líder estourou o timeout no teste de concorrência das
  transferências. A causa era um deadlock real no `accounts`, corrigido num PR próprio (#118); sob
  carga o teste ainda passava de 5 s e ganhou timeout explícito. A retomada esbarrou numa permissão
  negada, e o líder concluiu a tarefa com o aval do responsável.

A partir desta rodada a medição é só de tempo; o experimento de custo terminou na rodada 3.

O que cada rodada ensinou:

- **Rodada 1.** O ritual de branch não funciona em worktree (ajustado acima). Devolver a tarefa ao
  subagente só para push e PR dobrou o custo dele: agora quem abre o PR é o líder.
- **Rodada 2.**
    - O `/check` serial no líder virou o gargalo; a resposta é o modo de um banco por worktree.
    - O _Test mapping_ de duas specs apontava para a mesma suíte (`migrations.spec.ts`), o que
      criou conflito entre PRs. Specs novas devem preferir suítes por módulo, como
      `tests/integration/<módulo>/schema.spec.ts`.
    - Os worktrees dentro do repositório quebravam o gate `lint` do working tree principal
      (corrigido acima).
- **Rodada 3.**
    - Cinco bancos e cinco Jest ao mesmo tempo não deram timeout. O `/check` levou 24–35 s sozinho,
      57 s com outros três bancos ativos e 69–70 s com quatro em paralelo depois do rebase. Rodar
      em paralelo continua compensando: os quatro terminaram em 70 s de relógio.
    - As duas paradas vieram de tarefas que eram as primeiras do seu tipo, não de ambiguidade de
      spec (ver _Briefing do subagente_).
    - Spec aprovada e gate podem divergir. As specs 0012 e 0013 mandavam chamar o `accounts`, e o
      gate proibia; a correção é um PR de gate do líder, nunca o subagente mexendo no gate.
    - Duas regras de fronteira sobre pacote nunca disparavam (`firebase-admin` sempre, `pg-boss`
      a partir de worktree), por causa do caminho resolvido. Corrigido no #113 (ver _Worktrees_).
    - Tarefas irmãs divergem no que a spec não fixa. O briefing passa a apontar o arquivo de
      referência.
    - Os conflitos de só-acréscimo (`api.config.ts`, `.dependency-cruiser.cjs`) se resolveram no
      rebase em minutos, como previsto. `src/platform/index.ts` mesclou sozinho.
    - Rodar o `/check` no líder antes do PR não pegou falha nenhuma nesta rodada, mas custa menos
      de um minuto e é a única saída que vai para o PR sem depender do relato do subagente.
- **Rodada 4.**
    - Conferir antes do lançamento as tarefas que são as primeiras do seu tipo, e mergear o PR de
      gate antes, eliminou as paradas da rodada 3.
    - Desta vez o `/check` do líder pegou o que o do subagente não pegou: o teste de concorrência
      só falhava sob a carga de outros `/check`. Ele continua obrigatório.
    - `SELECT ... FOR UPDATE` numa linha pai conflita com o `FOR KEY SHARE` que o Postgres toma ao
      inserir uma linha filha com FK para ela, e duas transações nessa ordem entram em deadlock.
      Para ajustar saldo ou limite sem mudar a chave, a trava é `FOR NO KEY UPDATE`
      (`lock: { mode: 'for_no_key_update' }` no TypeORM).
    - Tarefas irmãs divergem também no comportamento provisório do que a spec deixa para uma tarefa
      futura. O briefing passa a fixar esse comportamento junto com o arquivo de referência.
    - Uma mensagem de commit saiu trocada entre duas tarefas e chegou ao `develop` (#119): os
      subagentes gravavam a mensagem no mesmo arquivo temporário. Daí a regra do diretório Git do
      worktree e do `git log -1` no briefing.
    - Com o rebase em cascata, a ordem de merge importou: cada merge deixou o PR seguinte em
      conflito de só-acréscimo (`api.config.ts`, `src/events/index.ts`), resolvido pelo líder em
      minutos, com novo `/check` de 37–61 s.
- **Gargalo real.** O limite não é o custo de tokens. É o grafo de dependências do backlog e a
  revisão humana dos PRs. Com mais subagentes, a quantidade de tarefas realmente independentes
  cai rápido, e a ordem de merge passa a ditar os rebases.
