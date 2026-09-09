---
sprint: 6
date: 2026-09-08
features: [3.2]
thread: null
---
# 006 — stress-multi-processo-no-nutshell

Mede e registra como teste o modo de falha do nutshell sob 8 processos concorrentes:
nenhum registro se perde, mas a cadeia quebra — o **inverso** exato do que a feature
1.2 encontrou no io-engine.

## Objetivo

O sprint 005 deixou uma pergunta explicita: o nutshell passa nos mesmos testes de
stress? A resposta era deduzivel do codigo ("No locks" esta na doc), mas deduzida nao
e medida. Este sprint mede, e transforma o resultado em teste que roda.

## O achado

Cenario identico ao da 1.2 — 8 processos x 30 escritas na mesma base:

| | io-engine (pre-1.2) | nutshell |
|---|---|---|
| workers crashados | ENOENT no rename | 0 |
| registros no disco | perdia registros | **240/240** |
| `verify().valid` | **true** | **false** |
| chaves distintas | — | 170–174 de 240 |

Controle com 1 processo: 30/30, `valid:true`, 30 chaves distintas — e o que separa
"ausencia de coordenacao" de "defeito de codigo".

**Mecanismo:** `prefixSet` e `prevKey` sao estado de closure privado por processo
(`io-nutshell.js:65-68`) e o `appendFileSync` (`:117`) nao toma lock. O append POSIX
abaixo de PIPE_BUF e atomico, entao nada se perde; mas cada processo encadeia a partir
do `prevKey` que julga ser o ultimo e calcula `shortestPrefix` contra um `prefixSet`
cego as chaves dos outros. Dai a colisao e a quebra.

**A inversao e o ponto.** O io-engine perdia registros e ainda reportava `valid:true` —
o `verify()` audita o que sobreviveu, nao o que sumiu. O nutshell preserva tudo e
**acusa** a quebra. A prova intrinseca faz o que promete: detecta o dano que a
arquitetura permite.

## O que foi feito

- `nutshell/io-nutshell.concurrency.test.js`: 2 testes, 8 checks. Assere o
  comportamento **observado**, nao o desejado — mesmo padrao que
  `io-engine.matrix.test.js:16-21` usa nas celulas `seed=false`. Um teste que exigisse
  `valid:true` aqui estaria exigindo que o nutshell tivesse locks, que e exatamente o
  que ele nao tem por design.
- `nutshell/io-nutshell.md`: uma frase em "What's Not Here". A doc segue minimal — 10
  secoes, como antes.
- `plans/3-nutshell/3.2.probe.js` + `3.2.eval.js`: sonda ao vivo e roteiro de 10 passos.

## Nota de medicao

`distinct` varia entre corridas (170 e 174 observados) porque depende do escalonamento
dos processos. O eval afirma `< 240`, nao um valor fixo — um numero exato aqui seria
falso rigor.

## Resultado

Suite do nutshell: 9 testes, 29 checks, verde. Feature 3.2 em 🟢 avaliada.

O modo coordenado (`{ lock: true }`) fica para a **2.2**, que extrai a secao critica
como `io-append.js` — modulo com dois consumidores, io-engine e nutshell. Quando isso
landar, este teste continua descrevendo o comportamento **default** do nutshell, que
segue sendo sem locks.
