---
sprint: 22
date: 2026-09-11
features: [4.5]
thread: null
---
# 022 — proj-na-arbitragem

Um bug de integridade que estava vivo, e o gap que o proprio codigo declarava em prosa
e nao fechava. Os dois eram o mesmo guarda.

## O numero

40 escritas, fechar, reabrir, contar:

| pageSize | paginas | antes | depois |
|---|---|---|---|
| 128 | 9 | 80 | 40 |
| 256 | 5 | 80 | 40 |
| 512 | 3 | 80 | 40 |
| 1024 | 2 | 80 | 40 |
| 2048 | 2 | 80 | 40 |
| 4096 | 2 | 40 | 40 |

Eram duplicatas de verdade, e nao registros a mais. So o 4096 escapava — e era o unico
tamanho que os testes usavam, e por isso o defeito atravessou tres sprints sem aparecer.

## A causa

`io-engine.js:273` era `statSync(f.proj).size > 4096`: um literal, e nao o `pageSize`
do store. Com pagina menor, uma projecao de VARIAS paginas ainda mede menos que 4096
bytes. O guarda a lia como vazia, o log inteiro era reaplicado, todo registro duplicava.

O comentario logo acima ja dizia a consequencia exata: *"replaying the whole log over
it would DOUBLE every record"*. O guarda existia para evitar isso e errava a conta.

**Tamanho nunca foi a pergunta certa.** O guarda precisa responder "quanto deste log ja
esta dentro da projecao?", e tamanho e um proxy para "tem alguma coisa" — o que importa
nao e SE tem, e ATE ONDE. O `logOffset` ja existia no rodape do pagedtext desde a 2.0,
com getter, setter e persistencia, e nao era lido por ninguem acima dele. Esta feature
so ligou as pontas.

## O gap que fechou junto

O mesmo comentario declarava um segundo problema e o deixava aberto: *"A stale .proj
(fewer records than the log) is a known gap this sprint does not close"*. Um `.proj`
atrasado era pulado por inteiro e as chaves que faltavam sumiam **em silencio**.

Medido: projecao de 12288 bytes cobrindo ate o offset 5598, log em 6996. Antes, as 20
chaves do delta eram perdidas; agora as 100 voltam, sem duplicata. O offset responde as
duas perguntas com o mesmo numero, entao fechar um gap fechou o outro.

## Um dono do flush

Havia quatro chamadas de `__flushPages()` — genese, yield a cada 100 flushes, `close()`
e o replay do sync. Um offset atualizado em so algumas delas seria **pior que nenhum**:
na abertura seguinte ele afirmaria cobertura que o arquivo nao tem, e o delta faltante
sumiria calado. As quatro passam por `flushProjection()`, que grava e registra o offset
no mesmo movimento. O `catch {}` mudo do `close()` saiu junto, como a feature pedia.

## Nao-vacuidade

Os dois testes novos foram rodados contra o codigo anterior (`git stash`): 6 checks
vermelhos, com o sintoma exato — 80 onde se esperava 40, e 80 chaves onde se esperava
100. Verdes com o conserto. O teste do `.proj` atrasado usa pagina de **4096** de
proposito: com pagina pequena o guarda antigo erraria para o outro lado e reaplicaria
tudo, dando a resposta certa por acidente — o teste nao discriminaria nada.

## Suites

`src` 406 checks (era 395, +11 dos dois testes novos); `pagedtext` 72, intocada.

## Reportado, nao consertado

O `~/utest` estava com `node_modules` vazio e o runner nao subia (`Cannot find package
'yaml'`, depois `'minimatch'`). Rodei `bun install` la para poder testar, o que
restaurou as dependencias que o `package.json` **ja declarava** — o manifesto e o
lockfile ficaram identicos ao HEAD (conferido com `git diff HEAD`). Fica o registro
porque aquele repo tem trabalho nao commitado de outra thread, e um `bun add` meu
chegou a remover `minimatch` do manifesto antes de eu reverter.

O `"test"` do `.sprint/config.json` continua apontando para `utest/utest.js` quando o
runner esta em `../utest/utest.js` — `sprint test` segue quebrado por isso, e e
independente desta feature.
