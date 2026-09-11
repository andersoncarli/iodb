---
sprint: 30
date: 2026-09-11
features: [8.6]
thread: null
---
# 030 — sqlite-table

Intro: `SqliteCollection` vestida com o contrato Table, nivel 5 -- schema dos PRAGMAs,
scan() por cursor real do driver, filter/group empurrados para SQL.

## Objetivo

Por a face de leitura do contrato sobre `SqliteCollection` (7.1, 🔵): schema lido dos
PRAGMAs, `scan()` por cursor real, `filter`/`group` empurrados para SQL -- o contrario da
8.5, prova de que o contrato cobre os dois extremos (so varredura vs. quase tudo interno).

## O que foi feito

- `src/adapters/sqlite.js` -- `col.iterate(sql, params)`, cursor real via `db.prepare()`
  (nao `db.query()`, que cacheia a Statement por texto de SQL e quebrava a lei de
  reentrancia entre dois scans concorrentes -- defeito real encontrado e corrigido nesta
  sessao).
- `src/table/sqlite-table.js` -- `sqliteTable(col, table)`: schema de
  `PRAGMA table_info`/`index_list`/`index_info` (o indice automatico da PK nao conta
  como `indexed`, senao toda tabela com PK viraria L5 de graca); `scan()` via
  `col.iterate()`, `rowsFetched` como prova; get/find/range so quando pk/indexed
  sustentam; `filter`/`group` (nivel 5) com traducao pequena (eq/comparacoes/and/or) e
  fallback para o que nao traduz; as tres armadilhas tratadas (NULL -> `IS NULL`,
  colacao case-sensitive, coercao).
- `src/table/sqlite-table.t.js` -- capabilities pelos PRAGMAs; cursor real com
  rowsFetched; as tres armadilhas comparadas explicitamente contra scan|>filter;
  filter/group traduzidos e nao traduziveis; conform() no nivel 5.
