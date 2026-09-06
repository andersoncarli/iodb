# 002 — Plano: saveIndex corrompe sob escrita concorrente multi-processo

Plano do sprint 002 (feature 1.2).

## Objetivo

Corrigir a corrupção de `saveIndex()` sob escrita concorrente multi-processo, documentada
como achado de homologação em `plans/1-core/1.2-*.md` (originado de `~/utest` feature 8.1).

## Passos

1. **`io-engine.concurrency.test.js`** — novo. Reprodutor: 8 processos `bun` reais
   (`Bun.spawn`) × 30 writes cada no mesmo `IO()` base, genesis semeado. Assertivas:
   nenhum exit ≠ 0, nenhum `ENOENT` no stderr, `verify().valid`, 240/240 registros.
   verify: `bun ../utest/utest.js io-engine.concurrency.test.js`.

2. **`io-engine.js` `saveIndex()`** — trocar `const tmp = f.index + '.tmp'` por
   `const tmp = \`${f.index}.${process.pid}.tmp\``. Temp privado por processo + rename
   atômico elimina a colisão na janela write→rename.

3. **`io-engine.js` `open()` ramo `else`** — o bloco `if (!existsSync(f.yaml))` que
   reconstrói o yaml passa a `acquireLock(f)` antes de escrever yaml + `saveIndex()`;
   release por `renameSync(myLock, f.yaml)` / `unlinkSync`, restauração no `catch`.

4. **`io-engine.js` `flush()` ramo não-centésimo** — mover `saveIndex()` para antes do
   `renameSync(myLock, f.yaml)`, de volta para dentro da janela do lock.

## Critério de pronto

- `bun ../utest/utest.js io-engine.concurrency.test.js` verde 10/10.
- Suite completa (`bun ../utest/utest.js .`) sem regressão.

## Fora de escopo

Eleição de genesis concorrente sem seed (~10% de perda quando 8 processos disputam o
primeiro write). Bug distinto — feature nova, não este sprint.
