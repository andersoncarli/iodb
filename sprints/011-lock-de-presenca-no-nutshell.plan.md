# 011 — Plano: lock-de-presenca-no-nutshell

Plano do sprint 011 (feature 3.3).

Objetivo, pedido original e o contrato que nao muda: `sprint fronts 3.3`.
Em uma linha: portar a polaridade da 4.3 para o nutshell, mantendo o lock
opt-in, e medir as duas engines sob a mesma carga.

## Passos

1. **Portar a polaridade.** Ausencia = livre, PID no nome, `wx` / `unlink`,
   varredura por `process.kill(pid, 0)`. O protocolo ja mora em `io-append.js`.

2. **Remover `ensureLock()`** (`nutshell/io-nutshell.js:117`) e a guarda de
   `existsSync` em `:114`. Sob ausencia = livre nao ha nascimento a proteger.

3. **`lock = false` continua o padrao** (`:56`). O teste caracterizador da 3.2
   descreve o caminho sem lock e segue valendo.

4. **Medir as duas engines.** 8 processos x 30 escritas: registros em disco,
   crashes, timeouts, `verify().valid`, tempo de parede.

5. **Explicar divergencias em vez de tirar media.** Hipotese a testar: se o
   nutshell sair na frente e por publicar menos artefato derivado, nao por travar
   melhor.

6. **Commitar a tabela** em `bench/`.

## Ressalva sobre o que a tabela pode afirmar

Enquanto a 1.5 nao cair, `verify().valid` reprova nas duas engines — o hash e
compartilhado desde o sprint 007. Ate la mede-se registros e tempo, nao validade
de cadeia. Nao bloqueia este sprint.

## Criterio de pronto

O declarado na feature. Verify:
`bun ../utest/utest.js nutshell/io-nutshell.concurrency.test.js --force`
