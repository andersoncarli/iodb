---
front: 7
keyword: adapter-parity
title: adapter-parity — todo backend do iodb responde a mesma superficie chaveada
state: active
updated: 2026-09-10
---
# [7] adapter-parity — todo backend do iodb responde a mesma superficie chaveada

O `iodb` tem duas famílias de armazenamento que hoje não falam a mesma língua.

De um lado, `IO(base, { reduce, initial })` — o engine append-only com projeção derivada.
Sua superfície de escrita é `io.in(patch, { flush })`, e para uma projeção `merge` chaveada
por id ela já é, na prática, um store keyed: `in({ [id]: row })` faz upsert, `in({ [id]:
null })` apaga (`merge` em io-engine.js:697-706: `v === null` → `delete acc[k]`), `get('#1')`
devolve o mapa inteiro.

Do outro, `src/adapters/sqlite.js` — `SqliteCollection`. Ele é um **passthrough de SQL
cru**: `in(patch)` faz `INSERT INTO {table}` incondicional (sqlite.js, sem upsert, sem
tombstone), `get(k)` interpreta `k` como nome de tabela e faz `SELECT *`. Não há noção de
store chaveado; quem quer um escreve o SQL na mão.

## O que esta frente entrega

**A mesma superfície `put/remove/all/flush`, chamada-por-chamada, nos dois lados.** Um
consumidor escolhe o backend por nome e o resto do código não muda. Não é reescrever o
`SqliteCollection` — é **somar** o contrato keyed ao passthrough que já existe, com um
teste de paridade que roda a *mesma* sequência de operações contra `IO(merge)` e contra
`SqliteCollection` e afirma que `all()` devolve conjuntos iguais.

A prova de que a paridade é real é o tombstone: `merge`'s `null` = `delete acc[k]` tem que
ser observacionalmente idêntico a `DELETE FROM {table} WHERE id = ?`. Se os dois `all()`
divergem depois de um `remove`, a superfície não está pareada.

## Por que uma frente, e não um item da 5 ou da 6

A frente 5 (refactorings) tem por critério **"nada mudou"**. Somar `put/remove/all/flush`
ao adapter **adiciona comportamento** — métodos novos, semântica keyed, tombstone. Não cabe
no contrato da 5.

A frente 6 (fswatch) tem por critério **evidência sobre o iodb a partir de um consumidor**.
O `fswatch` é quem *pediu* essa superfície (o `SqliteStore` do sprint 017 é a camada keyed
que ele teve que carregar sozinho), e a 6.3 é o primeiro consumidor do resultado. Mas a
mudança em si é do engine, não do fswatch, e o alvo natural — "todo adapter responde à
mesma interface" — é maior que sqlite: é uma propriedade do conjunto de adapters.

## O que esta frente NÃO cobre

**Os outros adapters.** `folder`, `file`, `jsonl`, `yaml`, `json`, `env` — cada um pode vir
a ganhar a superfície keyed numa feature própria. A 7.1 faz sqlite porque é o par que a 6.3
precisa medir contra o `iodb`; o resto é trabalho futuro desta mesma frente.

**Um seletor de backend unificado.** `db-factory.js` já tem `BACKENDS` e `parseSignature`;
harmonizar a resolução (`DB('x sqlite store')` devolvendo a superfície keyed) é feature
separada, depois de os adapters concordarem no contrato.

**Performance.** Pareamento é sobre *forma*, não custo. Quem mede o custo de um contra o
outro é a 6.3, com o `fswatch/bench.js`.
