# 024 — Plano: indice-paginado-4k-spike

Plano do sprint 024 (feature 2.4). Comecou como o SPIKE DE DECISAO
(B-tree propria vs `bun:sqlite`, com numero na mesa) e cresceu, por pedido
explicito do usuario apos ver o numero ("de fato nos precisamos de ambos"),
para o CONTRATO DE INDICE plugavel: as duas abordagens viram implementacoes
de primeira classe atras da mesma interface, em vez de uma escolhida e a
outra descartada.

## Objetivo

1. (spike) Responder com numero: sqlite ou B-tree propria em paginas de
   texto? Resposta: cada uma vence em criterios diferentes (sqlite: fast-open
   e range; texto: cat/grep e Node+Bun) — motivo para as DUAS existirem.
2. (contrato) Definir a interface (`open/close/get/put/del/range/rebuild`) e
   um registro nome->factory, com as duas abordagens como plugins.

## Passos

1. `plans/2-pagedtext/2.4.spike.js` — mede `open()`, lookup pontual e range
   para as duas abordagens no mesmo corpus (20k/100k).
2. `src/index-contract.js` — a forma do contrato + `assertIndexShape`.
3. `src/index-registry.js` — `registerIndex`/`createIndex`/`knownIndexImpls`,
   com `text-pages` registrado como default.
4. `src/index-textpages.js` — implementacao de referencia (Map persistido em
   linhas JSON); prova o contrato, NAO ainda o formato de pagina 4096/slotted
   descrito em `2.4-indice-paginado-4k.md` (isso e um incremento seguinte
   sobre este mesmo arquivo, sem mudar o contrato).
5. `src/adapters/sqlite.js` — `SqliteIndex`, satisfaz o mesmo contrato com
   `bun:sqlite`; auto-registra `'sqlite'` ao ser importado.
6. `src/index-registry.t.js` — suite parametrizada rodando os MESMOS testes
   contra as duas implementacoes, mais um teste de concordancia direta
   (mesmo corpus, mesmo resultado).
7. `plans/2-pagedtext/2.4.probe.js`/`2.4.eval.js` — prova de concordancia e
   de que nenhuma implementacao concreta vaza para fora do registro.

## Criterio de pronto

Duas implementacoes registradas concordam byte a byte em get/put/del/range;
uma terceira implementacao de teste se registra sem editar `io-engine.js`
nem os testes existentes; suites `src`/`pagedtext` verdes.

## Fora de escopo deste sprint (proximos incrementos da 2.4)

- Formato de pagina real (4096 bytes, slotted page, checksum, freelist) para
  `text-pages` — hoje e um Map serializado em linhas JSON, correto mas O(n)
  por escrita.
- `io-engine.js` ainda NAO fala com o contrato — continua com seu proprio
  `.index` write-only e replay via `syncFrom`. Trocar isso e o proximo
  incremento, e um bug real (nao um gap de design): ligar o contrato ao
  engine muda o comportamento de `open()`, entao merece sprint proprio com
  seu criterio de fast-open medido (o mesmo criterio literal da 2.4).
