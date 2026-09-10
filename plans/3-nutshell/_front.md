---
front: 3
keyword: nutshell
title: Nutshell — revisao from-scratch do primitivo IO
state: active
updated: 2026-09-08
---
# [3] nutshell — revisao from-scratch do primitivo IO

O `nutshell/` e uma reescrita do primitivo IO em ~160 linhas, com um contrato
bem mais estreito que o `io-engine.js` (435 linhas): um par de arquivos
(`.jsonl` append-only como verdade + `.json` como projecao derivada), cinco
verbos (`in`/`out`/`get`/`flush`/`verify`), cadeia de hash onde a chave E a
prova de integridade, e reduce plugavel — merge vira KV store, append vira
event stream, mesmo motor.

Esta frente **nao substitui** o `io-engine.js`. Ela existe para tornar o
prototipo executavel e medivel neste repo, produzindo a evidencia que uma
decisao de arquitetura precisa.

## A tensao que esta frente deixa aberta

O nutshell declara "No locks. No WAL. No fsync." enquanto a frente `2 pages`
endurece exatamente a concorrencia multi-processo que a 1.2 provou corromper o
indice. As duas linhas puxam em direcoes opostas: uma persegue elegancia
single-process, a outra durabilidade multi-processo.

Escolher entre **assimilar as ideias no `io-engine.js`** ou **promover o
nutshell a nova base** e um sprint proprio — deliberadamente fora daqui.

## O que ficou medido (sprint 005)

Ping-pong reativo, lookup por hash, verificacao de cadeia e a curva de
profundidade de chave reproduzem. O **throughput de escrita nao**: a doc publica
~9.000 rec/s, mas seis corridas deram 2.283–9.093 (mediana ~6.000). O numero
publicado e alcancavel, nao tipico — e fica como questao aberta.
