# ISSUES — kanban rapido de QA

<!-- system file -->

Registro quick-and-dirty de problemas a resolver depois — nos sistemas de trabalho
(`sprint`/sprint-cli, `utest`, `quickrs`) e no proprio `iodb`. Uma linha por item. O
detalhe forense, quando existe, mora em [`ISSUES/`](ISSUES/).

Colunas: **TODO** (visto, nao comecado) · **DOING** (em conserto) · **BLOCKED** (esperando
decisao ou outra coisa) · **DONE** (resolvido — some daqui no proximo pente).

Formato de linha: `- [sistema] frase curta — <ponteiro opcional>`

---

## TODO

- [sprint] `sprint test` executa entradas `*.eval.js` do `verify_tests` como script `bun` e
  quebra o degrau — [ISSUES/001](ISSUES/001-sprint-test-eval-js-em-verify-tests.md)
- [sprint] 6.1 e 6.2 tem `bun plans/.../N.F.eval.js` no `verify_tests` (malformado, contra a
  convencao) — tirar a linha; fica so a suite utest
- [sprint] `docs-check.js` loop da raiz nao filtra diretorios; um dir `.md` na raiz crasha
  `EISDIR` — [ISSUES/002](ISSUES/002-sprint-close-docs-check-eisdir.md)
- [utest] dois caminhos posicionais: so o primeiro roda, em silencio — `UTEST-ISSUE.md`
- [sprint] politica: `ISSUES.md` como registro de QA/kanban deveria ser parte do metodo
  (proposto nesta thread; nao implementado)
- [sprint] `sprint close` grava `.git/SPRINT_COMMIT_MSG` do sprint ANTERIOR: a saida imprime o
  titulo certo e o arquivo tem outro — quem segue o `git commit -F` que o tool sugere
  commita com o titulo errado — [usecases/15-IODB-2.md](../sprint-cli/docs/usecases/15-IODB-2.md)
- [sprint] `sprint close` bumpa versao no `package.json` mesmo num sprint que so mexeu em
  `plans/`+`sprints/` — derivar do que foi encenado, ou `--no-bump` visivel
- [sprint] `sprint feature new` semeia `verify_tests: [utest .]`, que nao e comando valido em
  lugar nenhum — semear do campo `test` do `.sprint/config.json`
- [sprint] `.sprint/config.json` tem `bun utest/utest.js .` sem o `../` — `sprint test` nunca
  roda neste projeto; reportado em `usecases/14-IODB.md` e ainda aberto
- [sprint] `sprint doctor` nao verifica que o comando de `test` resolve — um `test` quebrado e
  indistinguivel de um `test` nunca rodado (reforca o item acima)
- [utest] agregado global `grand` (exit code) conta `failed`/`exception` vazados entre
  arquivos concorrentes — `page-cursor.t.js` + `tabular-table.t.js` juntos derrubam o exit
  code mesmo com todo `state` `passed` — [ISSUES/003](ISSUES/003-utest-grand-failcount-cross-file.md)
- [iodb] `src/fixtures/tabular-pre-8.2.csv` foi gerado sem `pageSize` pequeno e virou 2633
  linhas de enchimento de pagina — regenerado (30 linhas), mas ainda STAGED, nao commitado
  — decisao pendente do usuario — [ISSUES/004](ISSUES/004-fixture-tabular-pre-8-2-tamanho.md)
- [iodb] `flushPages()` re-renderiza a projecao INTEIRA a cada flush (ordena e re-encoda toda
  chave); a ESCRITA ja e diffada por pagina, mas o re-render nao — com 400 entries no store,
  acrescentar UM custa 86ms. E o teto que sobra depois das correcoes do fswatch abaixo, e o
  que ainda impede o fswatch de ser a fonte de arvore padrao de um runner (indexar custa
  ~2.5ms/entry contra 0.03ms de um `readdirSync`). O comentario do proprio
  `replacePagesDiffed` assume o O(store) como "by nature" — mudar isso precisa de sprint
  proprio na frente do engine — detalhe em `utest/ISSUES/002-iodb-flush-o-store.md`
- [iodb] `renderPage()` do pagedtext repete uma unidade pequena de enchimento (` ,\n`) em
  vez de um unico campo largo — proposta do usuario, FORA do escopo de qualquer sprint
  aberto (mexe em nucleo compartilhado por 6 features ja 🔵); precisa de sprint proprio na
  frente 2 se for adiante — [ISSUES/006](ISSUES/006-pagedtext-fill-unidade-repetida.md)

## DOING

_(vazio)_

## BLOCKED

- [iodb] `src/fixtures/tabular-pre-8.2.csv` sumiu do disco duas vezes na sessao 2026-09-11,
  sem comando explicito que o apagasse — causa raiz nao isolada, intermitente —
  [ISSUES/005](ISSUES/005-fixture-desaparece-intermitente.md)

## DONE

- [fswatch] tres defeitos de performance/contrato corrigidos em 2026-09-11, com o `utest`
  como primeiro cliente real (autorizado pelo usuario). Detalhe forense em
  `utest/ISSUES/001`, `003` e `004`:
  - `reconcile()` gravava sem buffer (`put` default `flush: true`), flushando o store inteiro
    a cada arquivo — 300 arquivos de **4901ms para 241ms** (20x);
  - `scan()` publico varria a arvore DUAS vezes (`scanner.scan()` e depois `snapshot()`),
    porque so o `snapshot` preenchia `path` — a segunda travessia sumiu;
  - `describe()` passou a preencher `path` (absoluto), entao entries lidos do store voltam a
    servir o idiom que o proprio `docs/utest-sprint-prep.md` publica — antes vinham TODOS sem
    `path`, e `relative(root, e.path)` devolvia `undefined` em silencio.

  Efeito combinado: indexar 400 arquivos caiu de ~6500ms para **814ms**; a suite do `iodb`
  caiu de 50s para 27s. 2703 checks verdes, os 14 do `fswatch.t.js` inclusos.

- [iodb] guarda de replay do `.proj` usava literal `4096` em vez do `pageSize`, e duplicava
  a projecao ao reabrir com pagina menor — resolvido na feature 4.5 (sprint 022): o guarda
  virou comparacao de `logOffset`, e o `.proj` atrasado passou a recuperar o delta em vez
  de perde-lo — [ISSUES/PROJ-REPLAY-ISSUE.md](ISSUES/PROJ-REPLAY-ISSUE.md)
