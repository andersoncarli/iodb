# 028 — Plano: tabular-table

Plano do sprint 028 (feature 8.4).

## Objetivo

Vestir o contrato `{schema, scan, get, find, range, count}` sobre
`src/tabular-projection.js` (2.2, 🔵) — capacidade que ja existe (schema
tipado, range com descarte de pagina por min/max), so faltando o contrato por
cima. Nivel 3 quando o schema tem `pk` e ao menos uma coluna `indexed`
(8.2 deu esses eixos ao CSV); nivel 0+count sem eles — `get`/`find` NAO
existem-e-lentos quando o schema nao os sustenta.

## Passos

1. `src/tabular-projection.js` ganha internals aditivos (`_store`,
   `_pageRows`, `_ensureFlushed`, `_resetPagesRead`, `_bumpPagesRead`,
   `rowCount()`) para que a Table por cima nao duplique decode nem indice.
2. `src/table/page-cursor.js` ganha um terceiro parametro opcional
   `readPage` (default `store.readPage`), para reusar o mesmo motor de
   avanco-por-pagina cedendo ROWS decodificadas em vez de linhas cruas.
3. `src/table/cursor.js` ganha `mapCursor(cursor, fn)`, generico.
4. `src/table/tabular-table.js` — `tabularTable(file, opts)`: `scan()`
   preguicoso via pageCursor+`_pageRows`; `get`/`find`/`range` so quando o
   schema tem `pk`/`indexed`, roteando por `range()` quando indexado e por
   `scan()|>filter` (fallback do executor da 8.1) quando nao; `count()`
   via `rowCount()` (soma do indice, O(paginas do indice), nunca abre pagina
   de dados).
5. `src/table/tabular-table.t.js` — capabilities por schema (nivel 3 vs
   nivel 0+count); scan/get/find/range corretos; range mantem descarte de
   pagina (mede `pagesRead` antes/depois); count nao abre pagina; `conform()`
   nos dois niveis; `limit(10)` sobre scan() de arquivo grande le O(1)
   paginas.

## Nota — defeito de terceiro (nao consertado aqui)

Descoberto durante o sprint: `page-cursor.t.js` + `tabular-table.t.js`
concorrentes vazam contagem de checks no agregado `grand` do `utest`, o que
derruba o exit code mesmo com todo `state` `passed` e `fails:[]`. Registrado
em `ISSUES/003-utest-grand-failcount-cross-file.md`. O `8.4.eval.js` filtra
por `state`/`fails` do `--json`, nao por `exitCode` bruto.

## Criterio de pronto

- `conform()` passa contra a projecao tabular, nos dois niveis (com e sem
  indice).
- `capabilities()` devolve `level: 3` com pk+indexed, `level: 0` (+count)
  sem.
- `range()` por cursor le menos paginas que uma varredura completa no mesmo
  arquivo.
- `count()` nao abre pagina de dados.
- `limit(10)` sobre `scan()` de arquivo grande le O(1) paginas.
- Suite completa do projeto sem falha real (`state`/`fails`, nao exit code
  bruto — ver nota acima).
