# 005 — Plano: Nutshell executavel — portar teste, corrigir import, reproduzir numeros

Plano do sprint 005 (feature 3.1).

## Objetivo

`nutshell/` chegou como uma revisao from-scratch do primitivo IO (~190 linhas, par
`.jsonl`/`.json`, cinco verbos, cadeia de hash como prova). A doc `io-nutshell.md`
publica numeros — ~9.000 rec/s, p50 0,77ms, 1.000 rallies de ping-pong — medidos em
OUTRO ambiente. Nada disso rodava neste repo.

Escopo fechado: fazer o nutshell **rodar aqui** e **reproduzir os proprios numeros**,
sem decidir ainda o rumo maior (assimilar no `io-engine.js` vs. virar a nova base).
A decisao de arquitetura precisa de evidencia real na mao; este sprint produz a
evidencia, nao a decisao.

## O que NAO muda

O `io-engine.js` e as frentes 1-core / 2-pages. O nutshell declara "No locks. No WAL.
No fsync." enquanto a frente 2 endurece exatamente a concorrencia multi-processo que
a 1.2 provou corromper o indice. As duas linhas puxam em direcoes opostas — e esse
conflito fica **explicitamente fora** deste sprint.

## Passos

1. `nutshell/io-nutshell.t.js` — o teste nao rodava com `bun` direto porque `test`,
   `check` e `withTempDir` sao globais injetados pelo runner `utest`, nao imports.
   Rodar pelo runner do projeto (`bun ../utest/utest.js nutshell/`) expos UMA falha
   real: o teste esperava `buf.dash`, residuo da nomenclatura do `io-engine.js`,
   quando o nutshell escreve `.jsonl`. Corrigir a extensao.
2. `nutshell/smoke-io.js:7` — importava `fromB64` de `./io-nutshell.js`, que nao o
   reexporta; a primitiva mora em `io-hash.js:27`. Apontar o import para a origem em
   vez de reexportar pelo motor (o motor nao deve alargar sua superficie para
   satisfazer um consumidor de benchmark).
3. Rodar smoke e demo e registrar os numeros observados contra os documentados.

## Criterio de pronto

- `bun ../utest/utest.js nutshell/` verde, sem falha.
- `bun nutshell/smoke-io.js` completa com cadeia valida.
- `bun nutshell/demo-io.js` completa as 5 secoes.
- Numeros observados registrados no report, comparados com os da doc.
