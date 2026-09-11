---
front: 6
keyword: fswatch
title: fswatch — o primeiro consumidor externo do iodb
state: confirmed
updated: 2026-09-10
---
# [6] fswatch — o primeiro consumidor externo do iodb

O `iodb` e um engine de armazenamento que, ate aqui, so foi exercitado pelos proprios
testes. Testes provam que o engine faz o que ele diz; eles nao provam que **alguem
consegue construir em cima dele**. Sao coisas diferentes, e a segunda so aparece quando um
consumidor real tem uma necessidade que ele nao escolheu para agradar o engine.

O `fswatch/` e esse consumidor. Ele entrou no repo como prototipo (`53282bf`), funciona, e
persiste em **SQLite**. Um projeto cujo produto e um engine de armazenamento carrega um
consumidor que usa o engine de outra pessoa — e essa e a frase que esta frente existe para
apagar.

## O que esta frente entrega nao e feature de fswatch

E **evidencia sobre o iodb**. As lacunas que o README do `iodb` declara em prosa — sem
indice secundario, sem compactacao, `open()` rele o log inteiro, `find()` e varredura
total — passam a ser sentidas por codigo que precisa delas resolvidas, e medidas em numero
(6.3). Um requisito derivado de um consumidor vale mais que um item de roadmap: ele vem com
o custo anexado.

O fswatch e um caso duro de proposito. Ele nao e um log de eventos, que seria o encaixe
confortavel do append-only. Ele e um **baseline mutavel**: milhares de entradas que sao
atualizadas no lugar, apagadas, e relidas inteiras a cada arranque. E exatamente o perfil
em que um log append-only paga caro, e por isso e o teste que informa.

## O encaixe e exato, e isso e o achado

A persistencia do fswatch esta atras de **uma unica fabrica**, `MetadataStore`
(`fswatch/fswatch.js:119`), com superficie `{ db, put, remove, all, close }`. A projecao do
`iodb` chaveada por `dev:ino` mapeia um-para-um:

| SQLite hoje                  | iodb                                          |
| ---------------------------- | --------------------------------------------- |
| upsert por `id`              | `io.in({ [id]: entry })`                      |
| `remove(id)`                 | `io.in({ [id]: null })` — tombstone do `merge` |
| `all()`                      | `Object.values(io.get('#1'))`                 |
| split `nodes`/`leaves`       | nao sobrevive — `kind` ja e campo de todo entry |

O `Scanner`, o `reconcile`, o `watchTree` e o baseline **nao mudam um caractere**. Se a
troca exigir tocar neles, a fabrica nao era o unico ponto de acoplamento, e isso e um achado
sobre o desenho — do fswatch e do iodb.

O split em duas tabelas existia por tipagem e indice do SQL. Numa projecao chaveada ele nao
compra nada. Sua morte e consequencia a registrar (6.4), nao detalhe de commit.

## O que esta frente NAO cobre

**As lacunas do proprio fswatch contra o seu README.** Sao tres, reais, e ja medidas:
`watch({ baseline: false })` esta documentado mas o codigo le `{ baselineFirst }`
(`fswatch.js:~300`), entao a opcao do README e silenciosamente ignorada;
`content_changed` esta na tabela de eventos e **nunca e emitido** (mutacao de conteudo sai
como `metadata_changed`, e `hash` e sempre `null`); e o `Filter.excludedDir` e definido e
**nunca chamado**, entao `exclude` filtra a entrega de eventos mas nao poda a varredura —
um `IGNORE: ['**/node_modules/**']` ainda percorre e vigia `node_modules` inteiro. Sao
bugs de honestidade do README, nao de persistencia. Viram frente ou features proprias; nao
entram aqui, pela mesma regra que a frente 5 aplica: mudanca de forma nao carrega conserto
junto.

**A compactacao do `.dash`** e **o indice secundario por path**. Sao lacunas do `iodb`, nao
do fswatch. Esta frente as **mede** (6.3, com `bun:sqlite` como polo de comparacao) e
entrega o numero para as frentes 2 e 4; nao as resolve.

**A superficie keyed do adapter SQLite do iodb.** A 6.3 compara os dois engines pela mesma
interface, e isso exige que `src/adapters/sqlite.js` ganhe `put/remove/all/flush` — mudanca
do engine, nao do fswatch. Mora na **frente 7 (adapter-parity)**, feature 7.1, que a 6.3
consome. O `SqliteStore` que o sprint 017 carregou dentro de `fswatch.js` some quando a 7.1
entrar.

**O backend.** Continua `node:fs.watch`, nao `inotify`. Sem cookie de `MOVED_FROM`/`MOVED_TO`,
sem deteccao de overflow de fila, sem reconciliacao automatica.

**Publicar o fswatch como pacote independente no npm.** A 6.2 resolve o acoplamento com o
repo o suficiente para os testes rodarem honestamente, e para.
