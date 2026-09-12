---
sprint: 35
date: 2026-09-12
features: [5.4]
thread: null
---
# 035 — janitor: comando utest no path, remove writeup migrado

Intro: `.sprint/config.json` passa a usar `utest .` (instalado no PATH), e o `ISSUES.md`
do iodb termina de ficar so sobre o iodb — os ultimos 5 itens de sprint-cli/utest e o
UTEST-ISSUE.md migraram para os repos donos.

## Objetivo

`sprint test` sempre falhava (`Module not found "utest/utest.js"`) porque
`.sprint/config.json` apontava `bun utest/utest.js .`, um caminho que nunca existiu dentro
do `iodb`. `utest` (como `sprint`) ja e instalavel no PATH via `bun link` — trocado para
`utest .`, sem caminho relativo.

Continuando a migracao da 5.3: `UTEST-ISSUE.md` (bug dos dois caminhos posicionais que o
`utest` ignora em silencio) migrou para
`~/utest/ISSUES/008-dois-caminhos-posicionais-segundo-ignorado.md`. Os 5 itens `[sprint]`
remanescentes no `ISSUES.md` do `iodb` (politica de ISSUES.md cross-repo, `SPRINT_COMMIT_MSG`
do sprint anterior, bump de versao indevido, `verify_tests` semeado errado, `doctor` nao
valida `test`) migraram para `~/sprint-cli/ISSUES.md`. O item de politica cross-repo foi
expandido la com uma proposta concreta: o proprio `sprint`/`utest` deveria formalizar onde
um achado e registrado, em vez de depender de varredura manual como esta sessao fez duas
vezes.

Confirmada a seguranca da troca (config + suite verde), o escopo ampliou: ~88 arquivos em
`plans/`, `sprints/`, `handoffs/` e `ISSUES/` que ainda chamavam `bun ../utest/utest.js` ou
`bun utest/utest.js` foram trocados para `utest`, so no prefixo do executavel — args, flags
(`--force`, `--json`), pipes (`| sed ...`) preservados identicos. Duas citacoes em prosa
historica (`sprints/001,004`, que descrevem "o comando NAO resolvia assim") ficaram de fora
de proposito — trocar mudaria o sentido do relato, nao so o comando.

Registrado tambem (a pedido do usuario) um quick issue em `~/sprint-cli/ISSUES.md` e
`~/utest/ISSUES.md`: `sprint test` e `utest` deveriam ser mais intercambiaveis — hoje
`sprint test <N.F>` roda `verify_tests:` e deriva o degrau 🟡, bookkeeping que `utest`
sozinho nao faz, entao rodar `utest .` direto pra iterar rapido nao alimenta o sprint. Ideia
a explorar: `utest --json` (ja existe) alimentando o `sprint` sem re-rodar a suite.

## Verificacao

- `utest . --force` — 2703 checks verdes (duas rodadas pegaram timeout intermitente em
  `fswatch.t.js`/`paged-projection.t.js`, conhecido — verde de novo sem mudanca no codigo).
- `sprint docs` — `docs:check — ok`.
