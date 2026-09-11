---
sprint: 25
date: 2026-09-11
features: [8.1]
thread: null
---
# 025 — contrato-table

Intro: o contrato Table de nivel 0 (`{schema, scan}`) nasce como codigo -- `isTable`/
`capabilities` por presenca de metodo, `conform()` como oraculo das leis de reentrancia,
pureza e equivalencia de capacidade, e `memTable` como a implementacao de referencia.

## Objetivo

Estabelecer o contrato `Table` (TABLE.md) como codigo executavel, nao so prosa: a suite de
conformidade que futuros backends (tabular, io, sqlite) terao que passar, provada nao so
pelo que aprova mas pelo que reprova -- duas tabelas deliberadamente quebradas (cursores
que compartilham posicao, find() que devolve resposta errada) confirmam que `conform()`
detecta a violacao certa, com a lei certa.

## O que foi feito

- `src/table/cursor.js` -- o protocolo minimo (`next/close/Symbol.iterator`) e os
  primitivos de fallback (`filterCursor`, `limitCursor`, `firstOf`, `countOf`, `toArray`).
- `src/table/mem-table.js` -- `memTable(rows, schema)`, a Table de referencia L0, com
  snapshot congelado para que mutar o array de entrada depois nao vaze pro scan.
- `src/table/contract.js` -- `isTable`/`capabilities`, deteccao por metodo, niveis 0-5.
- `src/table/conformance.js` -- `conform(makeTable, rows, opts)`, as leis de reentrancia,
  pureza e equivalencia de capacidade.
- `src/table/mem-table.t.js` -- 7 testes, incluindo os dois casos de rejeicao deliberada.
