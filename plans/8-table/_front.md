---
front: 8
keyword: table
title: table — a superficie minima de leitura sobre a qual uma algebra relacional se apoia
state: confirmed
updated: 2026-09-11
---
# [8] table — a superficie minima de leitura sobre a qual uma algebra relacional se apoia

O `iodb` tem seis maneiras de guardar dados e **nenhuma maneira de le-los**. Nao no sentido
de que a leitura nao funciona — funciona. No sentido de que cada backend responde a uma
superficie diferente, todas materializam, e nenhuma declara o que sabe fazer rapido.

O inventario, verificado:

- `src/io-engine.js` devolve `{open, close, in, flush, get, yaml, out, records, verify,
  header, state, find, size, family, path}`. `records()` (:685 → :600) le e parseia o
  `.dash` **inteiro** a cada chamada. `find(pred)` (:690) e `recs().map().filter()` —
  varredura total, sem indice. `get(ref)` (:679 → :580) resolve da projecao em memoria e,
  no miss, cai numa **varredura completa** em :594.
- `src/tabular-projection.js` tem schema de verdade (`parseSchema` :48), tipos com ordem
  total, e `range(name,lo,hi)` (:299) que **pula paginas** por min/max (`summarize` :243).
  E a peca mais proxima do alvo — e **nao e importada por ninguem**: `grep tabular
  src/io-engine.js` nao devolve nada.
- `pagedtext/pagedtext.js` expoe `readPage(i)` (:498) — acesso por pagina, real. Mas a `api`
  publica (:911-999) tem forma de Array e **todo leitor chama `store.allLines()` antes**.
- `src/paged-projection.js` finge preguica: tem `Symbol.iterator` (:254) e ate um
  `function*` (:255), mas ele chama `allSeq()` (:163), que materializa primeiro.

E as ausencias, que sao o assunto desta frente. **Nao existe `scan` em lugar nenhum. Nao
existe `count()` como metodo. Nao existe cursor de leitura. Nao existe `schema` no engine.
Nao existe um unico `async function*` no repo.** Toda leitura, em todo backend, devolve um
array inteiro.

## A ideia unificadora: `{ schema, scan }` e suficiente

`table/TABLE.md` fixa a tese e ela e pequena o bastante para caber numa linha: **uma tabela
e um par `{schema, scan}`; todo o resto e capacidade opcional com fallback por varredura.**

```text
find(f, v)  =  scan() |> filter(eq(f, v))
range(f, b) =  scan() |> filter(between(b))
count()     =  scan() |> count
```

Disso decorre a regra que governa a frente inteira:

> **Otimizacao nunca pode ser requisito de correcao.**

Um backend que so sabe varrer e uma tabela completa. `get`, `find`, `range`, `count` nao
mudam o que a tabela *significa* — mudam o que ela *custa*. E por isso que a prova desta
frente nao e "a query devolve a resposta certa", e sim: **a mesma suite de conformidade roda
contra memoria, contra CSV paginado, contra o log `.dash` e contra o sqlite, sem alterar uma
linha, e todos passam.** O que varia entre eles e o nivel de capacidade declarado (L0..L5) e
o numero de paginas lidas — nao a resposta.

## Por que agora

Porque as pecas existem e estao desconectadas. A 2.2 entregou schema tipado com ordem total
e indice por pagina, e ficou orfa. A 2.5 entregou projecao paginada. A 7.1 pareou a
superficie **de escrita**. O que falta e o contrato de **leitura** que transforme essas
pecas em fontes intercambiaveis — e ele e barato de escrever e caro de adiar, porque cada
consumidor novo que chega inventa a sua propria leitura, como o `fswatch` inventou o seu
proprio `SqliteStore`.

## O que esta frente NAO cobre

**A algebra relacional.** `filter`, `project`, `group`, `sort`, `join`, `union`, o
otimizador e o plano fisico das secoes 10-11 e 19-21 do `TABLE.md` **nao moram aqui**. Nao
existe nenhum no relacional no repo hoje — o `makeNode` de `src/node-core.js:48` e no de
**arvore reativa**, outra coisa. A algebra e a **frente 9**, e ela consome esta. A unica
coisa parecida com algebra que entra aqui e o executor de fallback minimo
(`filter`/`limit`/`count` sobre cursor) que a 8.1 precisa para *provar* que L0 e
semanticamente completo — 40 linhas de oraculo, nao um motor.

**A superficie chaveada de escrita.** `put/remove/all/flush` e a **frente 7**, e a divisao
e limpa: a 7 pareia como se **escreve**, a 8 define como se **le**. Um adapter pode ter uma
sem a outra. A 7.1 ja fez sqlite; a 8.6 poe a face de leitura no mesmo objeto sem tocar na
de escrita.

**O formato das paginas e o indice no disco.** E a **frente 2**. A 2.4 (indice paginado 4K,
⚫) e dona do mapa chave→offset, do fast-open e da leitura por prefixo **no nivel do
armazenamento**. Esta frente nao inventa indice: ela **declara** o que a tabela sabe fazer e
usa o que existir. E por isso que **nenhuma feature da 8 bloqueia na 2.4** — e a propriedade
que a arquitetura de capacidades compra. A 8.5 entrega a tabela do log em L1 usando a
projecao em memoria que ja existe (`io-engine.js:580`), com `find` **ausente** e portanto
resolvido por varredura. Quando a 2.4 fechar, `find` e `range` sao **somados** ao objeto e a
mesma suite de conformidade roda sem editar um caractere. Se ela nao rodar, a separacao
entre logico e fisico nao era real.

**Escrita atraves da Table.** O contrato e de leitura: `scan/get/find/range/count`. Quem
escreve e `in()` ou a superficie keyed da frente 7. A tabela **observa**, e a secao 14 do
`TABLE.md` chama isso de pureza da observacao — ler nunca muta.

**Paralelismo.** A secao 15 pede `scan({partition})`. Esta frente entrega a **precondicao**
dele — cursores com estado independente, exigidos e testados na 8.1 — e para ai. Particao e
extensao, nao requisito do minimo.

## Ordem das features

**8.1** (o contrato, a suite de conformidade e a tabela de memoria) → **8.2** (o schema
normalizado, reconciliando as duas gramaticas) → **8.3** (o cursor preguicoso sobre
`pagedtext`) → **8.4** (a projecao tabular vira Table L3) → **8.5** (o log `.dash` vira
Table L1/L4) e **8.6** (o sqlite vira Table L5) em paralelo → **8.7** (o catalogo `db.users`).

A 8.1 vem primeiro porque ela e o **oraculo**: escrever a suite de conformidade antes de
qualquer backend real significa que cada backend seguinte nasce com a sua prova pronta. A
alternativa — implementar as tabelas e depois tentar generalizar um teste — e como a
paridade de adapters chegou tarde na frente 7.
