---
sprint: 24
date: 2026-09-11
features: [2.4]
thread: null
---
# 024 — indice-paginado-4k-spike

Intro: o spike virou contrato — as duas abordagens medidas nao competem mais
por um vencedor unico, coexistem atras da mesma interface como plugins.

## O numero

Corpus de N linhas `{id: {value, n}}`, id com 8 digitos zero-padded. Baseline
"scan/replay" e o que `io-engine.js` faz hoje sem indice real (le o `.dash`
inteiro, popula um `Map`) — nao existe B-tree propria ainda, entao o custo
dela HOJE e esse replay. `bun:sqlite` usa `id TEXT PRIMARY KEY` (B-tree nativa
do SQLite).

| operacao | N | scan/replay (hoje) | bun:sqlite |
|---|---|---|---|
| open() | 20k | ~25-75ms (3 runs) | ~0.45-0.57ms |
| open() | 100k | 262ms | 0.46ms |
| lookup pontual | 20k/100k | 0.005-0.013ms | 0.10-0.16ms |
| range (1% do espaco, 100k) | 100k | 40.2ms (1001 linhas) | 0.82ms (1001 linhas) |

Leitura: o `Map` em memoria vence lookup pontual (ja esta tudo carregado —
sem custo de round-trip a um DB, so um hash lookup) mas so DEPOIS de pagar o
`open()` inteiro. `bun:sqlite` inverte: `open()` e quase zero porque nao
materializa nada, e o lookup paga uma query real — ainda 50-100x mais rapido
que o replay completo seria seguido de lookup. Range e onde a diferenca mais
importa para a 2.4: 40ms vs 0.8ms em 100k, e cresce com N no scan enquanto
fica estavel no sqlite (indice B-tree real).

**Fast-open** — o criterio literal da 2.4 ("open() de um store de 100k nao e
O(tamanho do log)") — e onde sqlite ganha estruturalmente: 0.46ms constante
contra 262ms que cresce linear com N.

## A decisao — ja tomada, antes deste sprint

O plano da 2.4 ([2.4-indice-paginado-4k.md:48-61](../plans/2-pagedtext/2.4-indice-paginado-4k.md#L48-L61))
ja registra, em 2026-09-10, a decisao do usuario: **paginas de texto
proprias**, sem rodar medicao, por tres motivos que nenhum numero muda —
`cat`/`grep`/`sed` continuam funcionando (sqlite e binario opaco); o engine
roda em Node e Bun hoje, `bun:sqlite` e Bun-only; e o `.dash` ja e o
write-ahead log, entao o WAL do sqlite nao agrega.

Este sprint rodou o spike mesmo assim (pedido explicito desta sessao, antes
de eu ter lido o plano) e o numero favorece sqlite em fast-open (262ms vs
0.46ms em 100k) e range (40ms vs 0.8ms) — exatamente os dois criterios que a
2.4 lista. Apresentado o numero, a primeira reacao foi manter a escolha de
09-10 (texto proprio). Alguns turnos depois, revendo os dois resultados lado
a lado, o usuario reabriu: **"de fato nos precisamos de ambos, e bom ter um
baseline comparativo com sqlite."** — e a decisao virou nao escolher, mas
tornar o motor de indice **plugavel**.

## O contrato

`src/index-contract.js` define a forma estrutural (duck typing, no estilo
dos outros adapters do iodb): `open/close/get/put/del/range/rebuild`, com
`assertIndexShape` para os testes provarem que uma implementacao nao esqueceu
um metodo. `src/index-registry.js` guarda `nome -> factory` (`registerIndex`/
`createIndex`/`knownIndexImpls`); `io-engine.js` (num incremento futuro) vai
pedir `createIndex(opts.indexImpl || 'text-pages', ...)` sem nunca importar
uma implementacao concreta.

Duas implementacoes de referencia:
- **`text-pages`** (`src/index-textpages.js`, default) — hoje um `Map`
  persistido em linhas JSON. Prova o contrato e preserva `cat`/`grep` e
  Node+Bun; NAO e ainda o formato de pagina 4096/slotted-page do design
  original — isso fica para o proximo incremento sobre o mesmo arquivo.
- **`sqlite`** (`SqliteIndex` em `src/adapters/sqlite.js`, opt-in) — tabela
  dedicada `idx(key TEXT PRIMARY KEY, offset INTEGER)`, auto-registrada ao
  importar o modulo (isola `bun:sqlite`, que e Bun-only, de quem nunca pediu
  sqlite).

`src/index-registry.t.js` roda a MESMA bateria de testes contra as duas
(round-trip, del, upsert, range, range vazio, rebuild, close/reopen) mais um
teste de concordancia direta: mesmo corpus de 50 chaves, mesmo resultado de
`get` e `range` nas duas. `plans/2-pagedtext/2.4.probe.js` prova, alem disso,
que uma TERCEIRA implementacao (`mem-fake`, um `Map` puro) se registra e
funciona sem tocar `io-engine.js` nem os testes existentes — a prova de que
"plugavel" nao e so um adjetivo no plano.

## Suites

`src` 406 -> 452 (+29 do `index-registry.t.js`, mais outras +17 de outra
thread entre sessoes). `pagedtext` inalterado em 72 (fora do escopo deste
sprint).

## Fora de escopo, proximo incremento

`io-engine.js` continua com seu `.index` write-only e replay via `syncFrom` —
ainda NAO fala com o contrato. Ligar os dois muda o comportamento de
`open()` (fast-open real) e merece sprint proprio, com o criterio literal da
2.4 medido em produto final (nao so no spike isolado). O formato de pagina
4096/slotted-page/checksum/freelist para `text-pages` tambem fica para
entao — o contrato foi desenhado para nao mudar quando isso chegar.

## Reportado, nao consertado

`sprint files 4.1` lista `io-engine.bench.js` e `io-engine.js` como arquivos
do sprint 4.1, mas nenhum existe nesses caminhos (o bench real esta em
`src/io-engine.bench.js`). Drift no registro do sprint 4.1, anterior a esta
sessao, fora do escopo deste spike.
