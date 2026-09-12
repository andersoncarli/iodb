# 006 — Plano: stress-multi-processo-no-nutshell

Plano do sprint 006 (feature 3.2).

## Objetivo

Responder com medida, nao com deducao, a pergunta que ficou aberta no fim do 005:
*o nutshell passa nos mesmos testes de stress que o io-engine?* E registrar a
resposta como teste que roda, nao como paragrafo num relatorio.

## Passos

1. **`nutshell/io-nutshell.concurrency.test.js`** (novo) — porta do harness de
   `io-engine.concurrency.test.js` (1.2) para o nutshell: `Bun.spawn` de 8 processos
   x 30 escritas na mesma base, mais o controle de 1 processo.
   Verify: `utest nutshell/io-nutshell.concurrency.test.js`.

2. **`nutshell/io-nutshell.md`** — UMA frase no bloco "What's Not Here" com a
   consequencia medida do "No locks". A doc e o mecanismo, nao o relatorio.
   Verify: `grep -c '^## '` continua 10 (nenhuma secao nova).

3. **`plans/3-nutshell/3.2.probe.js`** (novo) — sonda que roda o cenario ao vivo e
   imprime as quatro propriedades. Existe para o eval nao precisar embutir um
   script inteiro numa string de shell.
   Verify: `bun plans/3-nutshell/3.2.probe.js 8 30` e `... 1 30`.

4. **`plans/3-nutshell/3.2.eval.js`** (novo) — roteiro de 10 passos, incluindo os
   dois guardas de escopo (motor intocado; `{ lock: true }` ainda nao existe).

## Criterio de pronto

- Suite do nutshell verde: 9 testes, 29 checks (21 da 3.1 intactos + 8 novos).
- O cenario 8x30 reproduz: `crashed=0`, `records=240`, `valid=false`, `distinct<240`.
- O controle 1x30 reproduz: `records=30`, `distinct=30`, `valid=true`.
- `git diff` vazio em `io-nutshell.js`, `io-hash.js`, `io-engine.js`, `hash.js`.

## Escopo — o que este sprint NAO faz

Nao corrige. O modo coordenado do nutshell (`{ lock: true }`) e entrega da **4.2**,
que extrai a secao critica como modulo `io-append.js` com dois consumidores. Aqui
so se caracteriza o comportamento default, que a doc declara e que continua valendo.
