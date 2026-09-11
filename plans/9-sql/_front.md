---
front: 9
keyword: sql
title: sql — a algebra relacional funcional sobre a qual um parser se mapeia sem pensar
state: active
updated: 2026-09-11
---
# [9] sql — a algebra relacional funcional sobre a qual um parser se mapeia sem pensar

A frente 8 fechou inteira e entregou o **substrato de leitura**: o contrato `{schema, scan}`
como codigo executavel (`src/table/contract.js:5`), a suite de conformidade que e o oraculo
de todo backing (`src/table/conformance.js:9`), o cursor como protocolo sincrono
(`src/table/cursor.js`), quatro backings em quatro niveis de capacidade diferentes, e o
catalogo preguicoso que produz `{op:'source', name}` sem tocar o disco
(`src/table/catalog.js:70`).

O que ela deliberadamente **nao** fez foi a algebra. O plano da 8 registra isso como decisao
tomada com o usuario: *"a frente 8 e so o substrato; a algebra e a frente 9 e consome esta"*.
O resultado, medido, e o assunto desta frente.

O inventario, verificado:

- Fora de `src/table/` o terreno e **virgem**. `grep -rn 'sort|orderBy|groupBy|join|distinct|
  pick|select|project'` em `src/`, fora de testes, devolve **apenas** `Array.prototype.join`
  para montar string, `path.join`, e `Array.sort` incidental. Nao existe **um unico operador
  relacional** no repositorio.
- `src/db.js` tem **143 bytes** — e um re-export, nao uma camada de query.
- O unico `GROUP BY` do repo esta em `src/table/sqlite-table.js:168`, dentro do backing, e e
  a forma exata `SELECT k as _group, count(*) as _count`. Nao ha group local com que
  compara-lo.
- A gramatica de expressao `{op, field, value}` com `and`/`or` **ja existe e e invisivel**:
  vive dentro de `translateFilter` (`sqlite-table.js:60-83`) e nenhum outro arquivo do
  repositorio sabe que essa forma existe. Pior: `conform` **nunca exercita `filter` nem
  `group`** (`conformance.js:14-17` chama quatro leis, nenhuma toca essas capacidades) — a
  gramatica nunca teve oraculo.

Ou seja: ha um contrato de leitura excelente e **nenhuma maneira de perguntar**.

## A superficie que a frente entrega

```js
from('users')
  .gte('age', 18)
  .sort('name')
  .limit(20)
  .pick('name', 'age')
```

Verbo mais campo como argumento, nao acessor por campo. `db.users.age.gte(18)` exigiria um
Proxy de dois niveis e faria um campo chamado `sort` ou `limit` colidir com o verbo; a
superficie fechada e finita e o que torna o mapeamento do parser mecanico.

**O objetivo declarado nao e um parser SQL.** E um *SQL funcional* — uma cadeia de nos de
dado puro, otimizaveis, sobre a qual um parser possa ser mapeado depois token a operador. A
ultima feature da frente prova isso, e ela e um teste, nao um parser.

## A ideia unificadora: semantica e capacidade sao camadas separadas

`sql/FUNCTIONAL-SQL-SPEC.md` secao 21 fixa a divisao, e a frente inteira decorre dela:

```text
SEMANTICA      filter project sort limit group aggregate join union
                                    |
                                otimizador
                                    |
CAPACIDADES    scan  get  find  range  count  filter?  group?
```

A algebra diz **o que**. A Table diz **o que sabe fazer rapido**. O otimizador e a unica peca
que conhece as duas. Dai a regra herdada da frente 8, uma linha adiante:

> **Otimizacao nunca pode ser requisito de correcao.**

Uma query sobre `memTable` (L0, so `scan`) tem que devolver **o mesmo conjunto** que a mesma
query sobre `sqliteTable` (L5, com filter e group empurrados para SQL). O que varia entre
elas e o plano fisico e o numero de paginas lidas — nao a resposta. E por isso que a peca
central desta frente nao e um operador: e o **oraculo** (9.4) que afirma essa igualdade
sobre os quatro backings, escrito **antes** de sort, group e join existirem.

## Tres decisoes tomadas com o usuario

1. **Execucao preguicosa, com terminais nomeados E `()`.** `.rows()`, `.cursor()`,
   `.first()`, `.count()`, `for...of`, e `()` como atalho de `.rows()` — a secao 19 da spec
   termina a cadeia com `()`, e os dois convivem.
2. **Otimizador por capacidade, sem modelo de custo.** As regras leem `capabilities(table)`
   (`contract.js:8`) e o schema; nenhuma le cardinalidade estimada. A unica leitura de
   tamanho permitida e `count()` quando a tabela o oferece de graca — numero exato e O(1),
   nao estimativa.
3. **Escopo completo de operadores, cada um em sua feature**, junção inclusive. Nucleo
   (source, filter, project, sort, limit, offset), agregacao (group, aggregate, count,
   distinct) e juncao (join, union).

## A fronteira com `src/table/`, e a unica entrada nela

A frente 9 e semantica; `src/table/` e capacidade. A regra e `git status --porcelain
src/table/` vazio — **com uma excecao deliberada, na 9.1**: a gramatica de expressao sai de
dentro do sqlite para `src/sql/expr.js`, e o sqlite passa a **importa-la**, em vez de a
frente conviver com duas copias da mesma forma. Isso toca uma feature confirmada, entao a
9.1 carrega a obrigacao de provar que `sprint eval 8.6 --yes` continua verde depois da
refatoracao. A extracao e comportamentalmente neutra por construcao — mesmos nomes de `op`,
mesma semantica de recusa — e o eval da 8.6 e exatamente quem sabe verificar isso.

Os arquivos moram em `src/sql/`. A raiz `sql/` ja e documentacao; `src/query/` divorciaria o
nome do codigo do nome da spec que o governa. Cuidado de nome: `src/node.js` e
`src/node-core.js` ja existem e sao **arvore reativa**, coisa diferente — `src/sql/node.js`
leva um comentario de cabecalho dizendo o que ele nao e.

## Declarado e fora de escopo

Tres coisas a frente declara e **nao** implementa, para nao virar a frente inteira:

- **Paralelismo** (spec secoes 15 e 16). A 9.8 escolhe agregadores decomponiveis
  `{init,step,merge,finish}` para nao fechar a porta, mas `scan({partition})` nao existe no
  contrato da 8 e inventa-lo aqui seria redesenhar `src/table/`.
- **Cursor assincrono.** A 8.1 declarou `Symbol.asyncIterator` como extensao sem
  implementacao; a algebra herda a posicao. Forcar `await` contaminaria os quatro backings
  sincronos por um consumidor que nao existe.
- **Escrita pela algebra** (`insert`/`update`/`delete`). O contrato Table e de leitura, e a
  pureza da observacao e lei da frente 8 — um verbo que muta quebraria a lei 2 da `conform`
  (`conformance.js:60`).

## As features

| # | feature | entrega |
|---|---|---|
| 9.1 | gramatica de expressao e o no puro | o atomo: `expr.js` + `node(op,args)`, e o sqlite importando a gramatica |
| 9.2 | schema derivado | `schemaOf(node)` — o insumo que substitui a estatistica que o otimizador nao tem |
| 9.3 | verbos, terminais e `asTable` | a DX do pedido rodando sobre os 4 backings, sem otimizador |
| 9.4 | a lei de ouro | `equivalence()` — o oraculo, antes dos operadores caros |
| 9.5 | otimizador nucleo | R1/R2/R3/R10 e `explain()` |
| 9.6 | acesso indexado | R4..R8 — get/find/range e o pushdown L5 |
| 9.7 | operadores bloqueantes | sort, top-k, skip, distinct |
| 9.8 | agregacao | group, aggregate, having e o pushdown do group |
| 9.9 | juncao e uniao | nested-loop indexado, hash join, R13 |
| 9.10 | a ponte para o parser | a prova de que o mapeamento e cego |

Caminho critico: `9.1 -> 9.2 -> 9.3 -> 9.4`, e dai 9.5/9.6 e 9.7 correm em paralelo; 9.8
depende da 9.7 (group streaming precisa de ordem) e 9.9 depende da 9.8 (schema qualificado).
**A 9.3 e o primeiro valor de ponta a ponta** — depois dela a expressao do pedido roda. **A
9.4 e a mais importante**, pelo mesmo motivo que a 8.1 foi da frente 8: escrever o oraculo
antes dos operadores caros faz cada operador nascer com a prova pronta.
