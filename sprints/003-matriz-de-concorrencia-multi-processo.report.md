---
sprint: 3
date: 2026-09-06
features: [1.3]
thread: null
---
# 003 — matriz de concorrencia multi-processo

Bateria parametrica (`io-engine.matrix.test.js`) varrendo format × reduce × seed × close
sob 8 processos concorrentes: confirma que o fix do sprint 002 fecha todos os pares
`seed=true`, e caracteriza o residual `seed=false` (~1-2%, era ~90%).

## Objetivo

Depois do sprint 002, sobrava a pergunta: as *outras* combinações de pares `iodb`
(formato `dash`, reducer `merge`, sem `close()`, sem seed de genesis) corrompem sob
concorrência? Este sprint responde com uma matriz de testes que roda cada célula com
processos `bun` reais e registra o comportamento.

## O que mudou

`io-engine.matrix.test.js` (novo) — `runCell({format, reducer, seed, close})` via
`Bun.spawn`, 8 processos × 30 writes por célula:

- 4 células `seed=true`: `dash`|`jsonl` × `append`|`merge`, todas com assert de limpo.
- 1 célula `no-seed` × N trials: assere `verify().valid` sempre e taxa de perda
  `<= TRIALS/4` (guarda contra reabrir o bug de 1.2).
- 1 célula `close=0`: documenta o flush-imediato de `in()`.

Nenhuma mudança em `io-engine.js` — este sprint é caracterização, não correção.

## Achados

| célula | resultado |
|---|---|
| `seed=true` × {dash,jsonl} × {append,merge} × `close=1` | **limpo**, 0% perda, `verify().valid` |
| `seed=true` × `close=0` | **limpo** — `in()` faz flush imediato por default; registros no disco sem `close()` |
| `seed=false` (disputa do 1º write) | **~1-2% de perda**, ENOENT ocasional (era ~90% pré-fix 1.2). Chain sobrevivente sempre `valid` — perda silenciosa, nunca corrupção |

### Residuais → feature 1.4

1. **Eleição de genesis não-atômica.** `open()` (~L314) sai da espera do perdedor
   quando `f.dash` tem `size > 0` — possível *entre* as linhas `#0` e `#1` de
   `writeGenesis()` (dois `appendFileSync` separados). O perdedor projeta a partir de um
   log com só a linha `#0`. Fix: publicar genesis num único write (ou tmp+rename atômico).
2. **`f.yaml + '.tmp'` fixo em 3 sítios.** `io-engine.js:186` (`writeGenesis`),
   `:199/201` (`flushYaml`), `:345` (`open()` else). Os dois últimos estão sob lock;
   `writeGenesis` só sob o `wx`-mutex. Mesmo padrão do bug de 1.2, risco residual
   estreito — vale sufixar por PID também.

## Evidência

- `utest io-engine.matrix.test.js` — 6 células verdes (32 checks).
- Caracterização out-of-band do `no-seed`: 1/60 trials perdeu (180/240, 1 ENOENT);
  0/60 nas demais. Pré-fix 1.2 era ~9/10.
- Suite completa: 📄14 🧪50 ✔232, sem regressão (002: 📄13 🧪44 ✔200).
