---
sprint: 23
date: 2026-09-11
features: [8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7]
thread: null
---
# 023 — frente-table

A frente 8 `table` nasceu com sete features: o contrato `{schema, scan}` como codigo
executavel, uma suite de conformidade que serve de oraculo para todos os backings, e o
caminho dela ate o catalogo `db.users`.

## Objetivo

Consolidar a API `Table` do `iodb` — a superficie minima de **leitura** sobre a qual uma
engine SQL relacional puramente funcional possa ser construida, conforme o design que o
usuario escreveu em `table/TABLE.md`.

Sprint de planejamento. Nenhum arquivo de `src/`, `pagedtext/` ou `table/` foi tocado.

## O que o inventario revelou

O `iodb` tem seis maneiras de guardar dados e nenhuma superficie comum de leitura. Isso ja
era a suspeita; o que o levantamento mostrou e que a situacao e mais extrema do que
"superficies diferentes":

**Nao existe `scan` em lugar nenhum. Nao existe `count()` como metodo. Nao existe cursor de
leitura. Nao existe `schema` no engine. Nao existe um unico `async function*` no repo.**

O unico `function*` de `src/` (`paged-projection.js:255`) chama `allSeq()` (:163), que
materializa antes de ceder o primeiro item. Os vinte metodos de leitura do `pagedtext`
(:911-999) comecam todos por `store.allLines()`. `records()` (io-engine.js:600) le e
parseia o `.dash` inteiro a cada chamada.

A preguica nao esta atrasada — nunca foi comecada. E essa descoberta reordenou o plano: a
8.3 (cursor preguicoso) virou feature propria em vez de detalhe de implementacao das
outras.

O outro achado foi `src/tabular-projection.js`. Ela tem schema tipado com ordem total
(`parseSchema` :48) e `range` que **pula paginas** por min/max (:299) — e nao e importada
por ninguem. `grep tabular src/io-engine.js` nao devolve nada. A peca mais proxima do alvo
estava orfa desde a 2.2.

## As tres decisoes

**Frente 8 e so o substrato; a algebra e a frente 9.** Por o otimizador aqui faria o
criterio da frente virar "uma query SQL roda", que nao e mecanicamente verificavel num
sprint. O criterio real e menor e testavel: *qualquer backing que passa a suite de
conformidade e fonte valida para uma algebra que ainda nao existe*.

**O POJO normalizado e canonico; as duas gramaticas sao parsers.** O `TABLE.md` propoe a
forma SOML `'id number pk autoinc': 0`; o `tabular-projection.js:48` ja implementa
`id:int@`. A tentacao era eleger uma. Mas a gramatica CSV **nao e uma API — e a primeira
linha do arquivo** (`boot()` :194-208), que e a tese pela qual a 2.2 foi confirmada.
Troca-la mudaria o formato em disco. Entao nenhuma das duas e canonica: o POJO e, e as duas
viram parsers, com lei de ida-e-volta e perda declarada (`schemaLossToCsv`).

**Cursor sincrono agora, async declarado.** Bate com o `node:fs` puro que faz o engine
rodar em Node e em Bun. Forcar `await` em todo backing local hoje contaminaria a suite
inteira por um consumidor (HTTP, shard remoto) que ainda nao existe.

## A propriedade que a arquitetura de capacidades comprou

**Nenhuma feature da 8 bloqueia na 2.4** (indice paginado 4K, ⚫), e isso nao foi sorte — e
o que a regra "otimizacao nunca e requisito de correcao" compra.

A 8.4 entrega nivel 3 hoje, porque o descarte de pagina por min/max ja resolve `range` sem
B-tree. A 8.5 entrega o log em nivel 1 com `find` e `range` **deliberadamente ausentes**: o
`find` que existe (io-engine.js:690) e O(n), e declara-lo como capacidade faria o
otimizador da frente 9 escolher o plano errado com confianca. Ausente, o executor cai na
varredura: mesma resposta, mesmo custo, custo agora **visivel**.

E a 8.5 deixa escrito, marcado como skip, o teste que cobra isso: no dia em que a 2.4
fechar, `find` e `range` sao somados ao objeto e a suite tem que passar **sem edicao**. Se
nao passar, a separacao entre logico e fisico nunca foi real.

## O que ficou de fora, e onde mora

| Fora | Onde |
|---|---|
| algebra: filter, project, group, join, otimizador | frente 9 (futura) |
| superficie chaveada de escrita: put/remove/all/flush | frente 7 |
| formato de pagina, indice chave→offset em disco | frente 2 (2.4) |
| invalidacao de cache do catalogo | frente 6 (fswatch) |
| paralelismo / `scan({partition})` | so a precondicao (cursores independentes, 8.1) |

## Verificacao

```
sprint fronts          →  8. table....... [⚫⚫⚫⚫⚫⚫⚫]
sprint fronts table    →  narrativa + as sete features na ordem
sprint fronts 8.1..8.7 →  objetivo, requisitos e proxima acao de cada uma
sprint docs            →  nenhum problema novo
```

O `sprint docs` reporta um problema, na 5.1 (`requirements: []` numa feature confirmada).
Ele e pre-existente: vem do commit `0641113` e nao tem relacao com este sprint.
