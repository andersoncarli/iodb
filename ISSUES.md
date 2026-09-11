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
- [iodb] guarda de replay do `.proj` usa literal `4096`, nao o `pageSize`; duplica a
  projecao ao reabrir com pagina < 4096 — `PROJ-REPLAY-ISSUE.md`
- [sprint] politica: `ISSUES.md` como registro de QA/kanban deveria ser parte do metodo
  (proposto nesta thread; nao implementado)

## DOING

_(vazio)_

## BLOCKED

_(vazio)_

## DONE

_(vazio — itens resolvidos saem daqui)_
