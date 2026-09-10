# 017 — Plano: metadatastore-iodb

Feature 6.1. O fswatch além de usar SQLite; a persistencia de metadados também passa a ser um
store `iodb` chaveado por `dev:ino`. a ambas as engines devem ser selecionaveis.

## Objetivo

Trocar o corpo de `MetadataStore` (fswatch/fswatch.js:119-167) por uma fabrica sobre
`IO(base, { reduce: merge, initial: {}, pageSize: 4096 })`, preservando a assinatura, de
modo que `Scanner`, `reconcile`, `watchTree` e o baseline nao mudem.

## As tres decisoes que este sprint escreve ANTES de codar

### 1. O batch na varredura — durabilidade trocada por viabilidade

O `iodb` faz fsync real por `in()`, ~1.0ms/registro (io-engine.paged.t.js:11-19). Medido
nas arvores que vamos usar de alvo:

| alvo       | arquivos | dirs | scan a 1ms/rec |
| ---------- | -------- | ---- | -------------- |
| iodb       | 214      | 29   | ~0.24s         |
| utest      | 177      | 19   | ~0.20s         |
| sprint-cli | 435      | 27   | ~0.46s         |
| soml       | 8154     | 324  | ~8.5s          |

Isso ja e COM `.git` e `node_modules` excluidos do caminhamento. Incluidos, os mesmos
alvos dao 1189/1443/3979/23135 arquivos, e o soml sozinho passa de 23s. A exclusao e a
decisao 4 abaixo.

**Decisao: o `Scanner.scan()` bufferiza.** `store.put` aceita `{ flush: false }`, e o
`scan()` faz um `store.flush()` no fim. O parametro existe no engine
(`write(payload, { flush: doFlush = true })`, io-engine.js:562).

O que se **perde**: durabilidade por registro DURANTE a varredura. Um crash no meio do
scan perde os registros bufferizados. O que **nao** se perde: correcao. A varredura e
reconstrutivel por definicao — e literalmente uma leitura do filesystem, que e a fonte de
verdade. Um baseline parcial perdido e refeito no proximo `scan()`. Esta e a mesma
doutrina da frente 2: *pagina corrompida = descarta e reconstroi da fonte de verdade*.

O caminho AO VIVO (watchTree) **nao** bufferiza: ali cada evento e uma observacao unica,
nao reconstrutivel, e 1ms por evento e barato.

### 2. O `.fswatch/` por projeto

O store deixa de ser `bun.sqlite` no cwd. Passa a ser `<projeto>/.fswatch/<nome>`, base sem
extensao, do qual o engine deriva `.dash/.yaml/.index/.lock/.proj`. Um dominio por projeto:
quatro alvos, quatro `.fswatch/`, nenhum banco compartilhado. O diretorio e criado se nao
existir e entra no `.gitignore` de cada projeto.

### 3. O `db:` sai da API

`db: store.db` vaza o storage. Entra `entries: () => store.all()` — a capacidade que os
testes querem, sem prometer engine.

### 4. `.git` e `node_modules`: contados e conhecidos, nao caminhados

Eles entram em `exclude`. Mas `exclude` no fswatch de hoje filtra a ENTREGA de eventos e
nao poda a varredura — o `Filter.excludedDir` e definido e nunca chamado. Nesta feature
isso NAO vira poda cega: o requisito e que o diretorio seja **contado e conhecido**.

Significa: o entry do proprio `.git`/`node_modules` e gravado (existe, tem `dev:ino`, tem
`mtime`), e a travessia PARA ali. O que se sabe e que o diretorio existe e quando ele
mudou pela ultima vez; o que nao se paga e o custo de 8 mil entries de `.git` por projeto.
Um `mtime` de diretorio muda quando seu conteudo muda, entao o sinal de "algo aconteceu
aqui dentro" sobrevive — o detalhe do que aconteceu e que nao.

Isso reduz o soml de 23135 para 8154 arquivos e o custo total dos quatro alvos de ~33s
para ~9.4s.

Consequencia de escopo: chamar `Filter.excludedDir` na travessia e exatamente uma das tres
lacunas que o `_front.md` declarou FORA desta frente. Aqui ela entra pela porta estreita —
so o suficiente para os alvos reais serem viaveis, com o entry do diretorio preservado.
A lacuna geral (o `exclude` do usuario podar a varredura em todo caso) continua fora.

## Passos

1. `fswatch/fswatch.js`: remover `import { Database } from 'bun:sqlite'`; trocar o corpo de
   `MetadataStore`; `put(e, { flush })`; somar `flush()` a superficie.
2. `fswatch/fswatch.js`: `Scanner.scan()` passa `{ flush:false }` e faz `store.flush()` no
   fim.
3. `fswatch/fswatch.js`: `dbFile` -> base em `.fswatch/`; `stats().database` -> `io.path()`;
   `api.db` -> `api.entries`.
4. `normalize(e)` no `put`: `size`/`hash` explicitos (o `merge` e RASO, io-engine.js:686 —
   ver risco 1 da 6.1).
5. `fswatch/fswatch.test.js`: reescrever o teste do rename para `fs.entries()`; somar o
   teste do flip dir<->file.
6. `fswatch/README.md`: 'SQLite remembers' e 'bun.sqlite' saem.
7. `plans/6-fswatch/6.1.eval.js`: o negativo estrutural + as quatro arvores reais.

## Criterio de pronto

`cd fswatch && bun test` verde; zero `bun:sqlite` em fswatch.js; nenhum `.sqlite` criado;
as quatro arvores reais varridas com o `.dash` conferido; e o diff mostrando
Scanner/reconcile/watchTree/baseline intocados na sua logica.
