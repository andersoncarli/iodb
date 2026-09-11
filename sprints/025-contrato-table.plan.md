# 025 — Plano: contrato-table

Plano do sprint 025 (feature 8.1).

## Objetivo

Escrever o contrato `Table` como código executável — `isTable`/`capabilities` — e a suite de
conformidade `conform()` que qualquer backing roda para provar que é uma `Table` válida,
mais a tabela de memória `memTable` como implementação de referência de nível 0.

## Passos

1. `src/table/cursor.js` — o protocolo de cursor: `next() -> Row|null`, `close()` opcional,
   iterável via `Symbol.iterator`. Uma função `cursorFromArray(rows)` que dá independência de
   posição por cursor (fecha sobre seu próprio índice).
2. `src/table/mem-table.js` — `memTable(rows, schema)`: `{schema, scan}`, nível 0. `scan()`
   devolve `cursorFromArray` sobre uma cópia congelada das rows (pureza: mutação externa do
   array de entrada não pode vazar).
3. `src/table/contract.js` — `isTable(t)` (duck-check: tem `schema` e `scan` de função) e
   `capabilities(t)` → `{level, has:{get,find,range,count,filter,group}}`, por presença de
   método, não por flag declarada.
4. `src/table/conformance.js` — `conform(makeTable, rows, opts)`: recebe uma fábrica
   `(rows) -> Table` e roda as quatro leis:
   - reentrância: dois cursores intercalados são independentes;
   - pureza: rodar `scan/get/find/range/count` repetidamente não muda respostas seguintes;
   - equivalência de capacidade: `get`/`find`/`range`/`count`, quando presentes, batem
     conjunto-a-conjunto com o fallback por varredura;
   - o mínimo (`filterCursor`, `limitCursor`, `firstOf`, `countOf`) como executor de fallback
     usado pela própria suite para calcular o "esperado".
5. `src/table/mem-table.t.js` — roda `conform(memTable, rows)` e confere `capabilities(memTable(...)).level === 0`;
   mais um teste de reentrância direto e um de `conform` reprovando uma tabela quebrada
   (cursores que compartilham posição; `find` que devolve resultado errado) nas leis certas.

## Critério de pronto

- `conform(memTable, rows)` passa inteira para uma tabela de 5 linhas.
- `capabilities(memTable(rows, schema))` devolve `{level: 0, has: {get:false, find:false, range:false, count:false, filter:false, group:false}}`.
- Uma tabela deliberadamente quebrada faz `conform` lançar/reportar falha nas leis de
  reentrância e equivalência, não silenciosamente passar.
- `bun ../utest/utest.js src/table` verde.
