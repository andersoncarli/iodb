# 007 — Plano: secao-critica-modular-io-append

Plano do sprint 007 (feature 2.2).

## Objetivo

Implementar a 2.2 como MODULO, nao so como movimentacao de codigo: a secao critica
destilada vira `io-append.js`, com dois consumidores desde o primeiro dia — io-engine
e nutshell. Um modulo com um consumidor so nao provou que e modulo.

## Passos previstos

1. `sprint files --drift` antes de codar — a 2.2 mapeava so `io-engine.js` e o sprint
   toca 5 arquivos. Deriva declarada e campo `files:` atualizado. **Feito.**
2. Unificar `hash.js` + `nutshell/io-hash.js`, com equivalencia matematica medida antes
   e depois. **Feito.**
3. Extrair `io-append.js` — lock + append guardado + publicacao arbitrada. **Feito.**
4. Segundo consumidor: nutshell com `{ lock: true }`, default `false`. **Parcial.**
5. Corte principal em `io-engine.js`: `saveIndex`/`flushYaml` saem do lock, arbitro por
   `lastOffset`, medido contra `bench/baseline-2.1.txt`. **NAO feito.**

## Resultado

Sprint encenado PARCIAL — ver o report. Passos 1-3 fechados e verificados; o passo 4
nao atinge `valid=true` e o passo 5 nao comecou. A feature 2.2 continua ⚫.

## Criterio que continua valendo para fechar a 2.2

- p95 do tempo-com-lock em 100k proximo do de 1k (secao critica O(1) no tamanho do
  store), medido contra o baseline de 2.1: hoje 17ms (1k) -> 733ms (100k), com 7/8
  workers batendo o lockTimeout em 100k x 8.
- `verify()` verde em todas as celulas da matriz.
- Cenario 8x30 do nutshell com `{ lock: true }`: `valid=true`, `distinct=240`. Sem a
  flag, mantem o comportamento caracterizado na 3.2.
