# 026 — Plano: schema-normalizado

Plano do sprint 026 (feature 8.2).

## Objetivo

Reconciliar a gramatica SOML do `TABLE.md` (`'id number pk autoinc': 0`) com a
gramatica CSV ja implementada em `tabular-projection.js` (`name:str,age:int?`),
normalizando as duas para o mesmo POJO canonico `{fields: {name: {type, pk,
unique, indexed, nullable, default}}}`. Nenhuma das duas gramaticas e
canonica; ambas sao parsers para o POJO, como factory functions.

## Passos

1. `src/table/schema.js` — `normalizeSchema(input)` (POJO | SOML | colunas-CSV
   -> POJO), `schemaToCsvCols(pojo)` (POJO -> colunas de `tabular-projection.js`
   + `loss`), `csvColsToSchema(cols)` (colunas -> POJO), `schemaLossToCsv(pojo)`.
2. `src/tabular-projection.js` — `parseSchema`/`formatSchema` ganham dois
   eixos novos, `!` (pk) e `=` (unique), aceitos em qualquer ordem junto de
   `?`/`@` (quatro eixos independentes, mesma regra ja implementada).
3. `src/fixtures/tabular-pre-8.2.csv` — gerado com o CODIGO DE HEAD (antes de
   `parseSchema` ser tocado), commitado como oraculo de retrocompatibilidade.
4. `src/table/conformance.js` (da 8.1, ja 🔵) ganha a quinta lei —
   `schemaCapabilityCrosscheck`: `get()` sem campo `pk` no schema, ou `find()`
   sem nenhum campo `indexed`, reprova com `law: 'schema-capability'`.
5. `src/table/schema.t.js` — testes da lei de ida-e-volta, do que se perde
   para CSV, dos quatro sufixos em qualquer ordem, da quinta lei de
   conformidade, e da leitura byte-a-byte do fixture pre-8.2.

## Criterio de pronto

- Lei de ida-e-volta passa para um conjunto de schemas cobrindo os quatro
  tipos, nullable, indexed, pk e unique.
- `schemaLossToCsv` reporta exatamente `default`/`autoinc`/`autohash` e nada mais.
- `src/fixtures/tabular-pre-8.2.csv` abre, parseia e le os mesmos registros
  com o codigo pos-mudanca, e `git diff` nele fica vazio ao fim do sprint.
- `conform()` da 8.1 reprova get()-sem-pk e find()-sem-indexed com a nova lei.
- Suite completa do projeto verde.
