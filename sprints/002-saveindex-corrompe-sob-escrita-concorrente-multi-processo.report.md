---
sprint: 2
date: 2026-09-06
features: [1.2]
thread: null
---
# 002 — saveIndex corrompe sob escrita concorrente multi-processo

`saveIndex()` deixou de corromper o índice sob N processos concorrentes no mesmo `IO()`:
temp por-PID + o `saveIndex()` sem lock do ramo `else` de `open()` agora sob `acquireLock`.

## Objetivo

Corrigir a corrupção documentada no achado `plans/1-core/1.2-*.md`: `saveIndex()` escrevia
sempre em `f.index + '.tmp'` — nome fixo compartilhado entre todos os processos que abrem
o mesmo `base` —, colidindo na janela write→rename. Sintomas: `ENOENT: rename
.index.tmp -> .index` derrubando writers (~90% das rodadas com 8 processos), e perda
silenciosa de registros que `verify()` não denuncia.

## O que mudou

`io-engine.js`:

- **`saveIndex()`** — `const tmp = \`${f.index}.${process.pid}.tmp\`` no lugar do nome
  fixo. Cada processo renomeia o próprio arquivo privado; atômico em POSIX.
- **`open()`, ramo `else`** — o bloco que reconstrói `f.yaml` transitoriamente ausente
  passou a rodar sob `acquireLock(f)` (antes: yaml write + `saveIndex()` sem lock nenhum),
  com release e restauração do lock no `catch`.
- **`flush()`, ramo não-centésimo** — `saveIndex()` movido para antes do
  `renameSync(myLock, f.yaml)`, de volta para dentro da janela do lock.

`io-engine.concurrency.test.js` (novo) — reprodutor multi-processo real via `Bun.spawn`:
8 processos × 30 writes no mesmo `IO()`, genesis semeado.

## Evidência

- `bun ../utest/utest.js io-engine.concurrency.test.js` — antes: `ENOENT` + 114–211/240
  registros em execuções sucessivas. Depois: 10/10 limpo, `verify().valid`, 240/240.
- Suite completa: 📄13 🧪44 ✔200, sem regressão (boot: 📄12 🧪43 ✔182; +1 arquivo/teste).

## Fora de escopo

Eleição de genesis concorrente sem seed: 8 processos disputando o primeiro write ainda
perdem ~10% dos registros. `open()` sai da espera do perdedor assim que `f.dash` tem
tamanho > 0 — possivelmente entre a linha `#0` e a `#1` de `writeGenesis()` (dois
`appendFileSync`). Bug distinto; feature nova.
