---
front: 4
keyword: concorrencia
title: Concorrencia — do lock do log ao consenso por pagina
state: active
updated: 2026-09-10
---
# [4] concorrencia — do lock do log ao consenso por pagina

Esta frente tem duas metades. A primeira ja aconteceu e chegou aqui vinda da frente 2,
onde nasceu grudada na paginacao: **medir** a secao critica (4.1), **encurta-la** ate o
indivisivel (4.2) e **desacoplar o mutex do dado** (4.3). Isso resolveu a concorrencia
do `.dash`.

A segunda metade e o que aquela nao resolveu: **o arquivo paginado ficou fora de toda
arbitragem.**

## Tres fatos delimitam o problema

1. `projection.__flushPages()` e chamado em `io-engine.js:536`, **depois** do
   `releaseLock` em `:529`, e em `:657` no `close()` **sem lock nenhum**. O `.proj` nao
   participa de mutex nem de arbitro de offset. O `.index` e o `.yaml` ja passam por
   `publishDerived` (`src/adapters/io-append.js:313`), que toma o lock **proprio** do
   arquivo derivado e arbitra por offset. O `.proj` nao.

2. `flushPages` (`src/paged-projection.js:247`) e uma **reescrita total** terminando em
   `rename`. Dois processos que tocam paginas **disjuntas** do mesmo `.proj` produzem
   last-writer-wins sobre o arquivo inteiro: o escritor lento apaga o trabalho do
   rapido. Nao ha janela de deteccao — nem checksum, nem geracao, nem offset no header.

3. **Nada testa o caminho paginado sob concorrencia.** Todos os testes de pagina sao
   single-process, e `grep -c pageSize src/io-engine.matrix.test.js` devolve **0**: a
   matriz de 679 linhas, que e o reprodutor fiel do projeto, nunca liga a paginacao.

## A troca que esta frente faz

**"Excluir para escrever" → "escrever e reconciliar"** — o desenho ja anotado na 4.3.
Paginas disjuntas nao precisam de lock global; precisam de **deteccao** de que a pagina
mudou debaixo de voce.

E a mesma escolha estrutural que a frente 2 fez ao recusar o WAL do SQLite: o `.dash`
**ja e** o write-ahead log e a fonte de verdade da qual tudo e derivavel, entao conflito
vira problema de **deteccao**, nao de rollback. Pagina em conflito = descarta e
reconstroi do `.dash`.

## O que esta frente NAO faz

Nao paraleliza o append do `.dash`. A cadeia de chaves (`hash.js:94`) serializa
escritores por construcao, e a frente 1 ja decidiu que integridade verificavel vale mais
que paralelismo. O alvo aqui e o arquivo **derivado**, onde a serializacao nao e
obrigatoria.

## Ordem das features

4.1 benchmark → 4.2 secao critica minima → 4.3 lockfile dedicado (as tres confirmadas,
vindas da frente 2) → 4.4 testes de concorrencia no primitivo paginado → 4.5 `.proj`
entra na arbitragem → 4.6 modificacao concorrente em arquivo grande → 4.7 consenso de
escrita por pagina.

A 4.5 e a correcao minima do fato 1 e nao depende do desenho de consenso — pode ser
adiantada se a 4.4 mostrar perda de dados severa. A **politica** do consenso (reler e
reaplicar, ou reportar conflito) e decidida na 4.7 **com a medicao da 4.4/4.6 na mao**,
nao antes.
