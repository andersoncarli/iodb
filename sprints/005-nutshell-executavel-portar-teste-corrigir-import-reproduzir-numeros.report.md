---
sprint: 5
date: 2026-09-08
features: [3.1]
thread: null
---
# 005 — Report: Nutshell executavel — portar teste, corrigir import, reproduzir numeros

Intro: o `nutshell/` chegou como uma revisao from-scratch do primitivo IO que nao
rodava neste repo; este sprint o torna executavel, remove tres defeitos reais e
mede seus numeros aqui — confirmando dois e refutando um.

## O que foi entregue

**Tres defeitos corrigidos.**

1. `io-nutshell.t.js` — o teste esperava `buf.dash`, residuo da nomenclatura do
   `io-engine.js`; o nutshell escreve `.jsonl`. Era a UNICA falha real da suite.
   O `ReferenceError: test is not defined` que aparecia ao rodar `bun` direto nao
   era defeito: `test`, `check` e `withTempDir` sao globais injetados pelo runner
   `utest`. Rodar pelo runner do projeto expos o defeito de verdade.
2. `smoke-io.js:7` — importava `fromB64` de `./io-nutshell.js`, que nao o
   reexporta. A primitiva mora em `io-hash.js:27`. Corrigido apontando para a
   origem, em vez de alargar a superficie do motor para servir um consumidor de
   benchmark.
3. `io-nutshell.js:25` — quatro imports mortos (`canonical`, `sha64`, `toB64`,
   `fromB64`), importados de `io-hash.js` e nunca usados. Removidos; so as quatro
   primitivas vivas ficam (`toBits`, `makeFullKey`, `shortestPrefix`, `verify`).

**Resultado:** `utest nutshell/` → 21/21 verde. Smoke e demo
completam.

## Os numeros — dois confirmados, um refutado

| Metrica | Doc | Medido aqui | Veredito |
|---|---|---|---|
| Ping-pong round-trips | 1.000 rallies, p50 0,77ms | 1.000 rallies, p50 0,657ms | ✓ confirma (melhor) |
| Lookup por hash | ~1,6M ops/s | ~569k ops/s | ~ ordem de grandeza, abaixo |
| Verificacao de cadeia | valida | ✓ valid (1002 records) | ✓ confirma |
| Curva de profundidade | pico em depth 10 (298) | pico em depth 10 (292-295) | ✓ confirma |
| **Escrita sequencial** | **~9.000 rec/s** | **2.283–9.093 (mediana ~6.000)** | **✗ nao confirma** |

O throughput de escrita e o achado. A primeira medicao deu 11.300 rec/s — acima da
doc — mas seis corridas mostraram variacao de 4x, e sob a carga do proprio eval cai
a ~4.000. O numero publicado e **alcancavel, nao tipico**. O eval afirma so o que se
sustenta e deixa isso registrado como questao aberta.

## Ruido conhecido, diagnosticado

`utest .` (suite inteira) faz `io-engine.concurrency.test.js` falhar 5x. Isolado ele
passa 18/18, medido 5 vezes seguidas. Os 8 arquivos do nutshell deixam a suite ~44%
mais lenta (16s → 23s) e esses testes multi-processo sao sensiveis a timing sob
carga — perdem registros (ex.: 210 de 240), nao corrompem.

**Nao e regressao do nutshell:** sem o diretorio a suite passa 220/220, e o nutshell
nao importa, nao e importado por, e nao compartilha arquivo com o `io-engine`. Ambos
os fatos sao verificados no eval (passo 11). Por isso `verify_tests` da 3.1 aponta
para `nutshell/`, nao para a suite inteira.

Vale como sinal para a frente 2: esses testes de concorrencia sao sensiveis a carga
de CPU, o que e informacao util para quem for mexer na secao critica.

## O que este sprint NAO decide

O conflito de fundo fica aberto, deliberadamente. O nutshell declara "No locks. No
WAL. No fsync." enquanto a frente 2 (4.2–2.5) endurece exatamente a concorrencia
multi-processo que a 1.2 provou corromper o indice. As duas linhas puxam em direcoes
opostas.

A escolha — assimilar as ideias no `io-engine.js` ou o nutshell virar a nova base —
e um sprint proprio, e agora tem evidencia real para se apoiar.
