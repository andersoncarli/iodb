# 030 — Plano: sqlite-table

Plano do sprint 030 (feature 8.6).

## Objetivo

Por a face de leitura do contrato Table sobre `SqliteCollection` (7.1, 🔵): schema lido dos
PRAGMAs, `scan()` por cursor real do driver, `filter`/`group` empurrados para SQL (nivel
5) -- o contrario da 8.5: se o `.dash` so sabe varrer, o sqlite sabe fazer quase tudo
internamente, e as duas passando a mesma suite prova que o contrato cobre os dois extremos.

## Passos

1. `src/adapters/sqlite.js` -- `col.iterate(sql, params)`: cursor real (`stmt.iterate()`
   via `db.prepare()`, nao `db.query()` que cacheia a Statement por texto de SQL e
   quebraria a lei de reentrancia entre dois scans concorrentes).
2. `src/table/sqlite-table.js` -- `sqliteTable(col, table)`:
   - `schema` de `PRAGMA table_info`/`index_list`/`index_info`, normalizado pelo POJO da
     8.2. O indice AUTOMATICO da PK (`origin:'pk'`) nao conta como `indexed` -- ja e
     coberto por `pk` -> `get()`; senao toda tabela com PK viraria L5 de graca.
   - `scan()`: `col.iterate()`, `rowsFetched` como prova de nao-materializacao.
   - `get`/`find`/`range` so quando pk/indexed sustentam (mesma regra da 8.4/8.5).
   - `filter(expr)`/`group(key)`: nivel 5, traducao pequena (eq/ne/comparacoes/and/or
     sobre coluna e literal); o que nao traduz devolve `null`, fallback e do chamador.
   - As tres armadilhas: NULL (`eq null` -> `IS NULL`, nao `= ?`, porque bind de null
     nunca casa em SQL mas `===null` casa em JS); colacao (case-sensitive por padrao,
     bate com `===` de JS); coercao (`0`/`false` nao coeercem entre si em nenhum lado).
3. `src/table/sqlite-table.t.js` -- capabilities pelos PRAGMAs (L5 com indice, L1 sem);
   scan por cursor real com rowsFetched; get/find/range/count; as tres armadilhas,
   comparando explicitamente contra scan|>filter; filter/group traduzidos e nao
   traduziveis; `conform()` no nivel 5.

## Criterio de pronto

- `conform()` passa contra a tabela sqlite.
- `capabilities()` reflete os PRAGMAs -- L5 com pk+indice, L1 sem indice.
- Um scan interrompido no decimo registro de uma tabela grande tem `rowsFetched` da
  ordem de 10, nao o total.
- `filter`/`scan|>filter` concordam nos tres casos-armadilha.
- Um predicado nao traduzivel cai no fallback (devolve `null`, o chamador varre).
- Suite completa do projeto sem falha real (state/fails).
