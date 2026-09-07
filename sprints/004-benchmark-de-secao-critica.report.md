---
sprint: 4
date: 2026-09-07
features: [2.1]
thread: null
---
# 004 — benchmark-de-secao-critica

Instrumenta `flush()` por fase e commita o baseline p50/p95/p99 que mostra a seção
crítica saindo de 17ms (1k registros) para 733ms (100k) — o número que a frente `2 pages`
existe para derrubar.

## Objetivo

Tornar "sub-milissegundo" uma afirmação verificável: não havia nenhum benchmark no repo, e
todo número discutido até aqui vinha de contagem de falhas de teste — fonte que se provou
ruído (cache do runner + teste estatístico).

## O que foi feito

- `io-engine.js`: `flush()` ganhou marcas de tempo por fase (precompute, lockWait,
  verifyStat, recompute, append, publish, critical) atrás de um parâmetro opcional `bench`
  em `IO()` — custo zero (um `if` sem alocação) quando ausente.
- `io-engine.bench.js`: grid 1k/10k/100k registros × 1/8 processos. Seeding em lote
  (`in(payload,{flush:0})` + um `flush()` por 1000 registros) para não pagar o custo O(n²)
  de um flush por escrita durante o setup; mede N escritas marginais isoladas por célula.
  Timeout de lock sob contenção vira dado (`timedOut`), não crash do grid.
- `TEST.yaml`: `**/*.bench.js` no include da fase `unit`, para o runner reconhecer o bench
  e seu teste de sanidade (instrumentação inerte: com/sem `bench` dá a mesma projeção).
- `bench/baseline-2.1.txt`: baseline commitado, com metadados de máquina/commit/data.

## Achado registrado (fora de escopo, não corrigido)

Perfilando o seeding, `shortestPrefix` (hash.js:114) apareceu como O(n) por chamada — cresce
com o tamanho do `prefixSet`. Documentado em `plans/2-pages/2.4-indice-paginado-4k.md` para
avaliar junto do spike de índice paginado; não é o gargalo que este front ataca (seção
crítica), é custo de pré-computo fora do lock.

## Resultado

Baseline nos 6 pontos da grade, auditável e reproduzível. Confirma a régua do usuário: a
seção crítica hoje está muito acima do sub-ms em stores grandes, e piora sob concorrência —
em 100k×8 processos, 7 de 8 workers bateram o `lockTimeout`. Esse é o número que decide se
`2.2` funcionou.
