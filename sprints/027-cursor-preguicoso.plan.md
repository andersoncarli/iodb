# 027 — Plano: cursor-preguicoso

Plano do sprint 027 (feature 8.3).

## Objetivo

Construir `pageCursor(store, from=0)` — o gerador que consome
`store.readPage(i)` pagina a pagina e cede linha a linha, sem nunca ter mais
de uma pagina decodificada viva. `pagesRead`/`livePages` sao a prova de que a
preguica e real, medida por contagem, nao por heap.

## Passos

1. `src/table/page-cursor.js` — `pageCursor(store, from)`: factory closure com
   `{pageIndex, lineIndex}` proprios, `next()`, `close()`, `Symbol.iterator`,
   `pagesRead` (paginas abertas) e `livePages` (0 ou 1, nunca mais).
2. `src/table/page-cursor.t.js` — reentrancia entre dois cursores; iteravel
   por for..of; `limit(10)` sobre arquivo grande le O(1) paginas; `pagesRead`
   monotonico; `livePages` maximo 1 contra `pageCount()` de `allLines()`;
   `close()` esgota sem lancar; `conform()` passa sobre um wrapper Table.
3. Nao toca `pagedtext.js` nem `makeCursor` (posicional, editor) — so consome
   `readPage`/`pageCount`, que ja existem.

## Criterio de pronto

- `limit(10)` sobre arquivo de muitas paginas le um numero pequeno de
  paginas, nao todas.
- `pagesRead` cresce monotonicamente com as linhas consumidas.
- `livePages` maximo 1 durante um scan completo.
- Dois cursores sobre o mesmo store passam a lei de reentrancia da 8.1.
- Suite completa do projeto verde.
