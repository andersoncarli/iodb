---
sprint: 26
date: 2026-09-11
features: [8.2]
thread: null
---
# 026 — schema-normalizado

Intro: as gramaticas SOML e CSV normalizam para o mesmo POJO canonico, com lei de
ida-e-volta, perda declarada (`schemaLossToCsv`), e a quinta lei de conformidade cruzando
schema com capacidade.

## Objetivo

Reconciliar a gramatica SOML do `TABLE.md` (`'id number pk autoinc': 0`) com a gramatica
CSV ja implementada em `tabular-projection.js` (`name:str,age:int?`), normalizando as duas
para `{fields: {name: {type, pk, unique, indexed, nullable, default}}}`. Nenhuma das duas
gramaticas e canonica -- ambas sao parsers para o POJO.

## O que foi feito

- `src/table/schema.js` -- `normalizeSchema`, `schemaToCsvCols`, `csvColsToSchema`,
  `schemaLossToCsv`.
- `src/tabular-projection.js` -- `parseSchema`/`formatSchema` ganham `!` (pk) e `=`
  (unique), aceitos em qualquer ordem junto de `?`/`@`.
- `src/fixtures/tabular-pre-8.2.csv` -- commitado ANTES de tocar `parseSchema`, oraculo de
  retrocompatibilidade: o codigo pos-mudanca le a gramatica de ontem, byte a byte.
- `src/table/conformance.js` (da 8.1) ganha a quinta lei -- `schemaCapabilityCrosscheck`:
  `get()` sem `pk` no schema, ou `find()` sem `indexed`, reprova.
- `src/table/schema.t.js` -- lei de ida-e-volta, perda para CSV, quatro sufixos em
  qualquer ordem, a quinta lei de conformidade, leitura do fixture.

## Nota

Durante o sprint 029 (8.5, ainda aberto) descobriu-se um defeito no `utest` (agregado
`grand` conta checks entre arquivos concorrentes) e um bug proprio nos testes desta sessao
(`withTempDir` sem `return`) -- nenhum dos dois afetou o CODIGO desta feature, que foi
reconfirmado com a suite corrigida. Ver `ISSUES/003`.
