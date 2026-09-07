# 004 — Plano: benchmark de secao critica

Sprint da feature **2.1** (frente 2 `pages`). Primeira da frente por necessidade: sem
medicao, nenhuma das outras quatro e avaliavel.

## Objetivo

Tornar "sub-milissegundo" uma afirmacao verificavel, medindo **tempo com o lock retido** por
fase de `flush()`.

Hoje nao existe nenhum benchmark no repo. As unicas cifras ja usadas para julgar um patch
do lock vieram de contagem de falhas de teste, e essa fonte e comprovadamente ruido:

- o runner **cacheia falhas e as re-reporta sem executar** (`utest.js:519-522`) — sem
  `--force`, duas rodadas nao sao comparaveis;
- `io-engine.matrix.test.js` e **estatistico por construcao** (linha 169: tolera
  `bad <= TRIALS/4`) — uma moeda viciada que as vezes da 4.

Foi assim que "4 -> 10 falhas" virou argumento contra o `Atomics.wait` no comentario de
`io-engine.js:40-47`. O argumento estrutural continua de pe; o numero, nao.

## Passos

1. **Instrumentar `flush()`** (`io-engine.js:236-273`) com marcas de tempo por fase:
   - spin de `acquireLock` (espera, fora do lock)
   - `statSync` da verify chain (`:240`)
   - `syncFrom` de recuperacao (`:241`, so quando outro escritor apendou)
   - `appendFileSync` (`:250`)
   - `saveIndex` (`:272`) e `flushYaml` (`:270`)
   - `rename` de release
   Guarda por env var/opcao, **custo zero quando desligado** — isto fica no caminho quente.

2. **Metrica principal:** tempo entre `acquireLock` retornar e o `rename` de release. E o
   numero que 2.2 precisa derrubar.

3. **`io-engine.bench.js`**: grade de 6 pontos — 1k/10k/100k registros x 1 e 8 processos.
   Reusa o padrao multi-processo ja estabelecido em `io-engine.matrix.test.js:52-112`
   (`mkdtempSync` por celula + `Bun.spawn` de workers), que ja isola storage corretamente.

4. **Saida:** p50/p95/p99 por fase + throughput (writes/s). **p95 e o numero de aceitacao** —
   media esconde exatamente a cauda que importa sob contencao.

5. **Commitar o baseline** junto, para que antes/depois seja auditavel sem depender de rodar
   na mesma maquina no mesmo dia.

## Criterio de pronto

- Baseline p50/p95/p99 por fase, nos 6 pontos da grade, commitado.
- Instrumentacao desligada nao altera o resultado do engine (suite verde com `--force`).
- O bench mostra o O(n) esperado: p95 do tempo-com-lock **cresce** com o tamanho do store
  (e o que 2.2 vai eliminar — este sprint so precisa tornar isso visivel).

## Verify

```
bun ../utest/utest.js io-engine.bench.js --force
bun ../utest/utest.js . --force
```

Nota: `.sprint/config.json:10` traz `bun utest/utest.js .` (sem `../`), caminho que nao
existe; o `package.json:8` tem o correto. Corrigir — reportado, fora do escopo deste sprint.
