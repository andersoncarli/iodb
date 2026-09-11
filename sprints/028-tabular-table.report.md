---
sprint: 28
date: 2026-09-11
features: [8.4]
thread: null
---
# 028 — tabular-table

Intro: `TabularProjection` (CSV paginado, 2.2) vestida com o contrato Table -- get/find/
range por cima do range com descarte de pagina que ja existia, count() O(indice).

## Objetivo

Vestir o contrato `{schema, scan, get, find, range, count}` sobre `src/tabular-projection.js`,
que ja tem schema tipado e range com descarte de pagina — sem construir capacidade nova, so
o contrato por cima do que a 2.2 (🔵) ja tinha.

## O que foi feito

- `src/tabular-projection.js` -- internals aditivos (`_store`, `_pageRows`,
  `_ensureFlushed`, `rowCount()`) para a Table por cima nao duplicar decode nem indice.
- `src/table/page-cursor.js` (8.3) -- terceiro parametro opcional `readPage`, reusado
  aqui para ceder rows decodificadas em vez de linhas cruas.
- `src/table/tabular-table.js` -- `tabularTable(file, opts)`: scan preguicoso via
  pageCursor+`_pageRows`; get/find/range so quando o schema tem pk/indexed; range mantem
  o descarte de pagina; count() via `rowCount()` (soma do indice, nunca abre pagina).
- `src/table/tabular-table.t.js` -- capabilities por schema (nivel 4 -- get+find+range+
  count juntos, count() sempre presente); range mede pagesRead antes/depois; conform()
  nos dois niveis; limit(10) O(1) paginas.

## Nota

Durante a re-verificacao desta feature descobriu-se um bug proprio nos testes da sessao
(`withTempDir` sem `return`, ver `ISSUES/003`) que mascarava asserções -- corrigido e a
feature reavaliada com a suite rodando de verdade antes da confirmacao humana.
