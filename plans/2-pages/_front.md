---
front: 2
keyword: pages
title: Paginacao 4K — indice B-tree e projecao paginada
state: active
updated: 2026-09-07
---
# [2] pages — Paginacao 4K: indice B-tree e projecao paginada

O `iodb` reescreve estruturas inteiras a cada escrita, o que e inviavel para um log
crescente. Tres fatos delimitam o problema:

1. `saveIndex()` reescreve o `.index` inteiro **dentro do lock**, a cada flush
   (io-engine.js:127-141, chamado em :272) — e o `.index` e **write-only**: nao existe
   parser dele no repo, `open()` sempre faz `syncFrom(0)`. Custo puro na secao critica.
2. `flushYaml` serializa a projecao inteira em YAML, tambem dentro do lock, a cada 100
   flushes (io-engine.js:214-219). O `.yaml` tambem nunca e lido de volta.
3. Nao existe mapa chave->offset nem leitura por range: todo miss de memoria degrada para
   varredura completa do `.dash`.

Consequencia: a projecao precisa caber inteira na RAM, `open()` custa o log inteiro, e a
escrita e O(n) no tamanho do store.

## O que esta frente NAO muda

**A cadeia de chaves fica.** `makeFullKey = sha64(payload) XOR sha64(prevKey)` (hash.js:94)
mais alocacao de prefixo contra o `prefixSet` global: escritas concorrentes nao podem ser
chaveadas independentemente — e por isso que flush() descarta o trabalho pre-computado
quando o arquivo cresceu (io-engine.js:240-248). Decisao: a integridade verificavel por
`verify()` vale mais que o paralelismo. O alvo e **O(1) por escritor com secao critica
minima**, nao append paralelo. Paginar nao remove essa serializacao.

## Inspiracao: SQLite

Adotar do SQLite: header versionado na pagina 1 (magic + versao + page_size — barato agora,
impossivel de retrofitar); **slotted page** (array de offsets no topo, celulas do fim para o
inicio — o que permite inserir sem memmove); freelist de paginas liberadas.

**Nao** adotar o WAL: o SQLite precisa dele porque faz update-in-place. O `.dash` **ja e** o
write-ahead log e a fonte de verdade da qual tudo e derivavel. Regra de recuperacao mais
simples: pagina corrompida = descarta e reconstroi do `.dash`. Crash-safety vira problema de
**deteccao** (checksum), nao de rollback.

O `iodb` ja tem um no sqlite (50-sqlite.js, sobre `bun:sqlite`). Usa-lo como infra de indice
e alternativa real, avaliada por spike na 2.4 — o provavel bloqueio e runtime (`bun:sqlite`
so existe no Bun; o engine hoje roda em Node e Bun com `node:fs` puro).

## Formato: paginas 4K legiveis

Paginas de 4096 bytes padded com espacos, mantidas em **texto**: `cat` continua mostrando o
estado. So e possivel porque o `iodb` passa a gerenciar a escrita manualmente, em vez de
delegar ao `stringify` do YAML — que so sabe emitir o documento inteiro e e a origem do O(n).

## Ordem das features

2.1 benchmark (pre-requisito: sem medicao nada e avaliavel) -> 2.2 secao critica minima ->
2.3 lockfile dedicado -> 2.4 indice paginado -> 2.5 projecao paginada.
