---
sprint: 27
date: 2026-09-11
features: [8.3]
thread: null
---
# 027 — cursor-preguicoso

Intro: `pageCursor(store, from)` cede linhas do PagedText pagina a pagina, sem nunca ter
mais de uma pagina decodificada viva -- `pagesRead`/`livePages` provam a preguica por
contagem, nao por heap.

## Objetivo

Construir o gerador que consome `readPage(i)` pagina a pagina e cede linha a linha, com
`pagesRead` como prova de que a preguica e real. Reentrancia por construcao: cada cursor
carrega seu proprio `{pageIndex, lineIndex}` em closure.

## O que foi feito

- `src/table/page-cursor.js` -- `pageCursor(store, from, readPage?)`: `next()`, `close()`,
  `Symbol.iterator`, `pagesRead` (paginas abertas), `livePages` (0 ou 1, nunca mais). O
  terceiro parametro `readPage` e opcional e sobrescreve o leitor de pagina -- a 8.4 reusa
  isso para ceder rows decodificadas em vez de linhas cruas, sem duplicar o motor.
- `src/table/page-cursor.t.js` -- reentrancia entre dois cursores; `limit(10)` sobre
  arquivo de 404 paginas le 1 pagina; `pagesRead` monotonico; `livePages` maximo 1 contra
  `pageCount()`; `close()` esgota sem lancar; `conform()` passa sobre um wrapper Table.
