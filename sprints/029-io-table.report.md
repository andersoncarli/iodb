---
sprint: 29
date: 2026-09-11
features: [8.5]
thread: null
---
# 029 — io-table

Intro: o log append-only `.dash` vestido com o contrato Table -- scan() em stream sobre
patches fundidos por chave de usuario, L1 (get+count) pelo caminho que ja existia,
find/range deliberadamente ausentes.

## Objetivo

Adaptar o engine append-only ao contrato: `scan()` em stream, L1 pelo caminho que ja
existe, e `find`/`range` ausentes de proposito -- o `find` do engine e varredura total,
expo-lo como capacidade mentiria sobre custo pro otimizador.

## O que foi feito

- `src/io-engine.js` -- `parseLine` exportada (era privada), reusada sem duplicar logica.
- `src/table/io-table.js` -- `ioTable(io, schema?)`: `dashLineCursor` le o `.dash` em
  blocos de 64KB (nunca `readFileSync` do arquivo inteiro); `scan()` acumula por CHAVE DE
  USUARIO durante um passe unico -- a identidade de uma row e a chave do registro de
  CRIACAO, patches seguintes fundem sob ela (decisao tomada com o usuario: "a tabela e
  uma projecao do log... patches localizados por scan"). `get()` so existe quando o
  schema declara pk. `count()` e `io.size`, O(1).
- `src/table/io-table.t.js` -- capabilities por schema; scan pula genese; get bate com
  scan|>filter|>first; `linesLive<=1`; pureza sob log que cresce; teste de promocao
  pos-2.4 escrito e marcado `.skip`.

## Nota — tensao de design

O `.dash` e uma sequencia de PATCHES, nao registros independentes: um patch tardio pode
alterar uma entidade criada cedo. `scan()` so pode ceder a row FUNDIDA apos esgotar o
log -- o que e genuinamente streaming e o MOTOR de leitura (blocos de 64KB, nunca duas
linhas cruas decodificadas ao mesmo tempo), nao o resultado por-linha.
