# ISSUES — kanban rapido de QA

<!-- system file -->

Registro quick-and-dirty de problemas a resolver depois no proprio `iodb`. Uma linha por
item. O detalhe forense, quando existe, mora em [`ISSUES/`](ISSUES/).

Defeito de ferramenta vizinha (`sprint`/sprint-cli, `utest`, `quickrs`) mora no `ISSUES.md`
dela, nao aqui — mesmo quando achado durante uma sessao do `iodb`.

Colunas: **TODO** (visto, nao comecado) · **DOING** (em conserto) · **BLOCKED** (esperando
decisao ou outra coisa) · **DONE** (resolvido — some daqui no proximo pente).

Formato de linha: `- [sistema] frase curta — <ponteiro opcional>`

---

## TODO

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

- [iodb] ~60 arquivos em `plans/` (`.eval.js` e `.md` de feature) chamavam
  `bun ../utest/utest.js`/`bun utest/utest.js` em vez do comando instalado — substituidos
  por `utest` (no PATH via `bun link`) em todos os arquivos, junto de `.sprint/config.json`
  e `verify_tests` das features novas. `utest` e `sprint` sao o verbo universal de teste/
  workflow em todos os projetos irmaos (`iodb`, `sprint-cli`, `utest`), nao mais um caminho
  relativo fragil a CWD.
- [iodb] `flushPages()` re-renderizava a projecao INTEIRA a cada flush (decodificava toda
  pagina + ordenava + re-encodava toda chave), so para achar onde UMA chave dirty entra numa
  lista ordenada — 86ms para acrescentar 1 entry a um store de 400. Resolvido na feature 1.6
  (sprint 033): `keyIndex` (lista ordenada de chaves) mantido vivo entre flushes; o prefixo
  antes da menor chave suja e copiado como texto CRU (sem decode/encode), so o sufixo
  deslocado e recomputado. Medido: "add no fim" ficou ~flat conforme N cresce 8x (razao
  1.44x para N=400→3200, contra o crescimento proporcional ao store antes) — detalhe em
  [ISSUES/007](ISSUES/007-flush-incremental-poc.md), cruzado com
  `utest/ISSUES/002-iodb-flush-o-store.md` (que documentou o teto primeiro).
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
- [iodb] `src/fixtures/tabular-pre-8.2.csv` foi gerado sem `pageSize` pequeno e virou 2633
  linhas de enchimento de pagina — regenerado (30 linhas, md5 `a32adc31...`), commitado em
  `9c58e18` — [ISSUES/004](ISSUES/004-fixture-tabular-pre-8-2-tamanho.md)
