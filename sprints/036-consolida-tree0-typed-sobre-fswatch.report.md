---
sprint: 36
date: 2026-09-16
features: [6.5]
thread: null
---
# 036 — consolida tree0+typed sobre fswatch

Arquiva o prototipo `fswatch/tree0`, conecta `fswatch/typed/tree.js` ao Type Tree real
(corrigindo um bug de resolucao postfix em `typed.js`), e da a `fswatch.js` um scanner
inicial alternativo (`bootstrap: 'typed'`) que separa topologia de metadata para varrer
arvores grandes mais rapido, com paridade exata de identidade (`dev:ino`) e shape.

## Objetivo

Duas exploracoes livres deixaram arquivos soltos em `fswatch/`: `tree0/` (prototipo
Q&D com um bug de sintaxe que nunca rodou) e `typed/` (Type Tree + topologia lazy, mas
`tree.js` nao usava `typed.js` de fato). `fswatch.js` ja e o servidor de watch 24x7
confirmado (6.1-6.4); faltava um scan inicial mais rapido que o `describe()` sequencial.

## O que foi feito

- `fswatch/tree0/` arquivado em `fswatch/docs/archive/tree0/`, com nota explicando a
  superacao — preservado para consulta, fora do caminho ativo.
- `fswatch/typed/tree.js` agora resolve o header CSV via `typed.js` (Type Tree),
  em vez de uma string hardcoded.
- Bug corrigido em `typed.js`: a resolucao de tipos postfix compostos (`pk = i autoinc`,
  `node-id-delta = node-id delta`) invertia base/operador e nao recursava numa
  referencia simples — quebrava ate o exemplo do proprio TYPED.md.
- `TypedScanner` adicionado a `fswatch.js` (`bootstrap: 'typed'`): `LazyTree` percorre
  a topologia via `readdir()` puro, depois `stat()` roda em paralelo (bounded) sobre
  todos os nos. Mesma identidade `dev:ino` e mesmo shape de entrada que o `Scanner`
  sequencial — paridade verificada, ~25% mais rapido ja num teste pequeno.
- `fswatch/typed/test/typed.t.js` e `typedtree.t.js` convertidos do formato cru
  (`console.assert`/`console.log`) para `test()`/`check()`, o padrao do projeto — isso
  tambem resolveu um falso-vermelho no `utest .` agregado (registrado como
  [utest ISSUES/014](~/utest/ISSUES/014-console-assert-cru-falso-vermelho-em-lote.md)).

## Verificacao

`sprint eval 6.5 --yes` — 8 passos, todos verdes. Suite completa (`utest .`): 2709 ✔,
0 falhas, estavel em multiplas rodadas.
