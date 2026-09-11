# 029 — Plano: io-table

Plano do sprint 029 (feature 8.5).

## Objetivo

Adaptar o engine append-only (`.dash`) ao contrato Table: `scan()` em stream, L1 (get+count)
pelo caminho que ja existe no engine, e `find`/`range` deliberadamente ausentes -- o `find`
do engine e varredura total, expo-lo como capacidade mentiria sobre custo pro otimizador.

## Passos

1. `src/io-engine.js` -- `parseLine` exportada (era privada), reusada pelo leitor em
   stream sem duplicar a logica de parse `{payload}#key` / `{"key":payload}`.
2. `src/table/io-table.js` -- `ioTable(io, schema?)`:
   - `dashLineCursor(path)`: le o `.dash` em blocos de 64KB, nunca `readFileSync` do
     arquivo inteiro. `bytesRead`/`linesLive` (<=1) sao a prova.
   - `scan()`: um passe sobre o log, acumulando por CHAVE DE USUARIO (identidade da row
     = a chave do registro de criacao, patches seguintes fundem sob ela via scan, nunca
     criam row nova -- o mesmo modelo que `io.state()`/`merge` ja usam).
   - `get(key)`: usa `io.get()` (que ja cai na varredura como fallback do proprio
     engine), so existe quando o schema declara `pk` (convencao: `_key`).
   - `count()`: `io.size` (`idx.recordCount`), O(1).
   - Schema: fornecido, inferido da projecao (`io.state()`, se ha linhas de usuario), ou
     ausente (`schema: null`, L0).
   - Pureza sob log que cresce: `dashLineCursor` fixa `endAt` = tamanho do arquivo na
     CRIACAO do cursor.
3. `src/table/io-table.t.js` -- capabilities por schema; scan pula genese (#0/#1);
   get() bate com scan|>filter|>first; count() O(1); `linesLive<=1` num scan completo;
   pureza (cursor nao ve `in()` posterior); close() esgota; `conform()` passa; teste de
   promocao pos-2.4 escrito e marcado `.skip`.

## Nota -- tensao entre "stream linha-a-linha" e "row = entidade fundida"

O `.dash` e uma sequencia de PATCHES (nao um arquivo de registros independentes como o
CSV paginado da 8.3/8.4). Um patch tardio no log pode alterar uma entidade criada cedo.
Por isso `scan()` so pode ceder a row FUNDIDA depois de esgotar o log inteiro -- o que
cresce e o acumulador de ESTADO por chave de usuario (do tamanho de `io.state()`), nao o
texto do log. O motor de leitura (`dashLineCursor`) e o que e genuinamente streaming: le
em blocos de 64KB, nunca materializa o arquivo inteiro numa string, e nunca decodifica
mais de uma linha crua por vez (`linesLive<=1`) -- diferente de `records()`, que faz
`readFileSync` do arquivo inteiro synchronous de uma vez so.

## Criterio de pronto

- `conform(() => ioTable(io, schema), rows)` passa.
- `capabilities()` devolve `level: 1` com `count` presente e `find`/`range` AUSENTES.
- `linesLive` maximo 1 durante um scan completo.
- `count()` nao le o arquivo (O(1) via `idx.recordCount`).
- Um cursor aberto antes de um `in()` nao ve o registro novo.
- O teste de promocao pos-2.4 existe, marcado skip.
- Suite completa do projeto sem falha real (state/fails).
