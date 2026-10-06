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
- arquivos que **pode** tocar, com a regra de só-acréscimo para os compartilhados;
- arquivos **proibidos**;
- o ritual de branch e o `node_modules` do worktree;
- os comandos de verificação permitidos e o modo de banco da rodada;
- o formato do commit, com rodapé `Task:` e a linha `Co-Authored-By` do modelo usado;
- as regras duras: nunca merge, push em `develop`, `--no-verify`, gate afrouxado ou saída de teste
  inventada;
- o relatório final: branch e hash, arquivos, `AC`/`INV`/`ERR` → nome do teste, saída real dos
  comandos e perguntas em aberto.

Modelo: `sonnet` para tarefa com spec fechada (o padrão). `haiku` só para levantamento read-only.
Tarefa que exige decisão de design não deveria estar paralelizada.

## Rodadas medidas

| Rodada | Data       | Tarefas                         | Modelo | Tokens por subagente                                                      | Duração do subagente |
| ------ | ---------- | ------------------------------- | ------ | ------------------------------------------------------------------------- | -------------------- |
| 1      | 2026-10-06 | T-0004-01, T-0012-03            | sonnet | ~51 mil e ~57 mil na implementação, mais ~55 mil e ~61 mil para push e PR | ~1–1,5 min           |
| 2      | 2026-10-06 | T-0004-02, T-0012-01, T-0014-01 | sonnet | ~59 mil, ~74 mil e ~72 mil                                                | ~1,5–2,5 min         |

Em ambas, nenhum subagente parou com dúvida sobre a spec e todos os `npm run check` saíram verdes na
primeira tentativa. Os subagentes tomaram decisões dentro da spec (proteção com `RangeError`,
formato de retorno de `businessToday`, FK só na migration), e o líder as conferiu antes do PR.

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
- **Gargalo real.** O limite não é o custo de tokens. É o grafo de dependências do backlog e a
  revisão humana dos PRs. Com mais subagentes, a quantidade de tarefas realmente independentes
  cai rápido, e a ordem de merge passa a ditar os rebases.
