# 023 — Plano: frente-table

Abrir a frente 8 `table` — a superficie minima de leitura sobre a qual uma algebra
relacional se apoia — e escrever as sete features que a compoem. Sprint de
**planejamento**: nenhum arquivo de `src/`, `pagedtext/` ou `table/` e tocado.

## Objetivo

O usuario escreveu `table/TABLE.md` (1292 linhas), o documento de design de uma interface
`Table` minima sobre a qual uma engine SQL relacional puramente funcional possa ser
construida. O pedido foi rever o que o `iodb` ja tem, medir a distancia ate essa tabela
ideal, e escrever a frente e as features.

A tese do `TABLE.md` cabe numa linha: **uma tabela e um par `{schema, scan}`; todo o resto
e capacidade opcional com fallback por varredura.** Dai decorre a regra que governa a
frente inteira: *otimizacao nunca pode ser requisito de correcao*.

## O inventario que motivou a frente

Levantado com citacao `file:line`, e ele e mais extremo do que parecia:

- `src/io-engine.js` — `records()` (:685 → :600) le e parseia o `.dash` **inteiro** a cada
  chamada; `find(pred)` (:690) e varredura total sem indice; `get(ref)` (:679 → :580) cai
  em varredura completa no miss (:594).
- `src/tabular-projection.js` — tem schema tipado (`parseSchema` :48) e `range` com
  descarte de pagina por min/max (:299, `summarize` :243). E a peca mais proxima do alvo e
  **nao e importada por ninguem**.
- `pagedtext/pagedtext.js` — `readPage(i)` (:498) e acesso por pagina real, mas toda a
  `api` publica (:911-999) chama `store.allLines()` antes.
- `src/paged-projection.js` — finge preguica: `Symbol.iterator` (:254) delega a `allSeq()`
  (:163), que materializa primeiro.

E as ausencias, que sao o assunto da frente: **nao existe `scan`, nem `count()` como
metodo, nem cursor de leitura, nem `schema` no engine, nem um unico `async function*` no
repo.** Toda leitura, em todo backend, devolve um array inteiro.

## Tres decisoes tomadas com o usuario

1. **Frente 8 e so o substrato.** A algebra (`filter`/`project`/`group`/`join`/otimizador,
   secoes 10-11 e 19-21 do `TABLE.md`) e a frente 9 e consome esta. Unica excecao: o
   executor de fallback minimo na 8.1, porque sem ele a lei "capacidade == varredura" nao e
   verificavel.
2. **O POJO normalizado e canonico; as duas gramaticas sao parsers.** A gramatica CSV de
   `tabular-projection.js:48` nao pode ser trocada porque *ela e a primeira linha do
   arquivo* — a tese da 2.2, ja 🔵. A SOML do `TABLE.md` e DSL de autoria.
3. **Cursor sincrono agora, async declarado.** Bate com o `node:fs` puro que o engine usa
   para rodar em Node e Bun. `Symbol.asyncIterator` fica declarado como extensao futura.

## Passos

1. `sprint feature new 8.1..8.7 --front table` — cria a frente (auto-bootstrap) e as sete
   features, sem reservar sprint. **Feito.**
2. Escrever `plans/8-table/_front.md`: inventario com `file:line`, a tese `{schema, scan}`,
   e as quatro fronteiras (algebra → frente 9; escrita chaveada → frente 7; formato de
   pagina e indice → frente 2; paralelismo → so a precondicao).
3. Escrever as sete features, em ordem de dependencia, cada uma com requisitos citando
   evidencia e um `criterio:` mecanicamente verificavel.
4. Verificar pelo proprio tool: `sprint fronts`, `sprint fronts table`, `sprint fronts
   8.1..8.7`, `sprint docs`.

## Ordem das features

```
8.1 → 8.2 → 8.3 → 8.4 → { 8.5 ∥ 8.6 } → 8.7
```

A 8.1 vem primeiro porque e o **oraculo**: escrever a suite de conformidade antes de
qualquer backend real faz cada backend seguinte nascer com a prova pronta. A alternativa —
implementar e depois generalizar um teste — foi como a paridade de adapters chegou tarde na
frente 7.

## Criterio de pronto

- `sprint fronts` mostra `8. table [⚫⚫⚫⚫⚫⚫⚫]` e a contagem global de planejadas sobe
  de 8 para 14 (a 4.5 subiu a 🟢 em paralelo).
- `sprint fronts table` imprime a narrativa e as sete features na ordem.
- `sprint fronts <N.F>` imprime objetivo, requisitos e proxima acao para cada uma das sete.
- `sprint docs` nao acusa problema novo. O unico problema que ele reporta e a 5.1
  (`requirements: []` numa feature confirmada), pre-existente ao commit `0641113`.
- Nenhum arquivo de `src/`, `pagedtext/` ou `table/` modificado; nenhum degrau movido.
