# 003 — Plano: matriz-de-concorrencia-multi-processo

Plano do sprint 003 (feature 1.3).

## Objetivo

`io-engine.concurrency.test.js` (sprint 002) cobriu **um** ponto: seed=true, jsonl,
append. Sobra a dúvida de como as outras combinações de pares `iodb` se comportam sob
escrita concorrente multi-processo. Este sprint constrói a bateria parametrica que varre
os eixos e **registra o comportamento de cada célula** — correções viram features
próprias.

## Eixos

| eixo | valores |
|---|---|
| `format` | `dash` (default) · `jsonl` |
| `reduce` | `append` · `merge` |
| `seed`   | `true` (genesis pré-escrito) · `false` (workers disputam o 1º write) |
| `close`  | `1` (`io.close()`) · `0` (buffer sujo, processo sai sem flush explícito) |

Cada célula: 8 processos `bun` reais × 30 writes no mesmo `IO()`. Reporta
`crashed` / `enoent` / `verify().valid` / `onDisk` vs. `PROCS*WRITES`.

## Passos

1. **`io-engine.matrix.test.js`** — novo. `runCell({format,reducer,seed,close})`
   parametrico via `Bun.spawn`. Testes:
   - 4 células `seed=true` (dash|jsonl × append|merge) — assertam limpo (0 crash, 0
     ENOENT, valid, 240/240).
   - 1 célula `no-seed` rodada `TRIALS` vezes — assere `verify().valid` sempre e
     `lossy <= TRIALS/4` (guarda contra reabrir o bug ~90% de 1.2; tolera o residual).
   - 1 célula `close=0` — documenta que `in()` faz flush imediato por default (240/240
     mesmo sem `close()`).
   verify: `utest io-engine.matrix.test.js`.

## Achados (registro — este sprint NÃO corrige)

- **seed=true, todos os pares: 0% perda** após o fix do sprint 002. `close=0` idem.
- **seed=false: ~1-2% de perda** com ENOENT ocasional (era ~90% pré-fix 1.2). Residual:
  `open()` (~L314) sai da espera do perdedor quando `f.dash` tem `size>0`, possível
  entre as duas linhas de `writeGenesis()` (`#0` / `#1`, dois `appendFileSync`). Fix
  real = `writeGenesis` publicar genesis atômico → **feature 1.4**.
- **`f.yaml + '.tmp'` ainda é nome fixo** em 3 sítios (`io-engine.js:186` `writeGenesis`,
  `:199/201` `flushYaml`, `:345` `open()` else). `flushYaml` e `open`-else estão sob
  lock; `writeGenesis` só sob o `wx`-mutex do `open()`. Risco residual estreito →
  candidato a **feature 1.4**.

## Critério de pronto

- `utest io-engine.matrix.test.js` verde.
- Suite completa sem regressão.
- Achados acima registrados no report e nos requisitos de 1.3.
