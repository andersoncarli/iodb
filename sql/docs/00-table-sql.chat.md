# Construção De Engines SQL

**User:** Anonymous
**Created:** 9/10/2026 23:54:36
**Updated:** 9/11/2026 15:04:48
**Exported:** 9/11/2026 15:05:52
**Link:** [https://chatgpt.com/c/6aa36d6c-78ac-83e9-a39b-733776951119](https://chatgpt.com/c/6aa36d6c-78ac-83e9-a39b-733776951119)

## Prompt:
9/10/2026, 11:57:34 PM

se uma engine quer implementar um parser sql (considere que já gerencia suas tabelas (jsonl & csv) e estruturas hierárquicas (como json e yaml), bem como é capaz de fazer lookup de chave primária em O(1). Seque um exemplo de comparativo. quais os servicos ou interfaces minimas que eu preciso para fornecer capacidades de consulta sql para ele? elabore e me ensine o básico da contrução de engines sql.

```
iodb  —  1695 entries
    scan (arvore inteira, 1x, comum aos dois)       136.5 ms
                                                           iodb         sqlite
    construcao do corpus                            108.6 ms         9.2 ms
    corpus em disco                                   510.5K         458.5K
    lookup por chave (200 de 200)                       0 ms         0.1 ms
    lookup por path  (200 de 200)                       2 ms         2.4 ms
    busca  name ~ .js  ( 240)                          0.3 ms         0.2 ms
    busca  kind = dir  ( 320)                          0.2 ms         0.2 ms
```

## Response:
9/10/2026, 11:57:36 PM

Sim. E o ponto importante é separar **parser SQL** de **engine SQL**.

Você já possui boa parte do que uma engine precisa no nível de storage. O SQL pode ser uma camada relativamente fina sobre isso.

No seu caso, eu pensaria assim:

```text
                    SQL
                     │
              ┌──────▼──────┐
              │   Parser    │
              └──────┬──────┘
                     │ AST
              ┌──────▼──────┐
              │   Planner   │
              └──────┬──────┘
                     │ Plan
              ┌──────▼──────┐
              │  Executor   │
              └──────┬──────┘
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
       scan()     lookup()   index()
          │          │          │
          └──────────┼──────────┘
                     ▼
                 IODB data
```

A grande vantagem da sua arquitetura é que **você não precisa construir um SQLite do zero**. Você precisa construir uma máquina de **álgebra relacional sobre IODB**.

---

# 1. O que SQL realmente faz

Um SQL simples:

```sql
SELECT name, size
FROM files
WHERE kind = 'file'
  AND name LIKE '%.js'
ORDER BY size DESC
LIMIT 20;
```

pode ser reduzido a:

```text
SCAN files
  ↓
FILTER kind = 'file'
  ↓
FILTER name LIKE '%.js'
  ↓
PROJECT name, size
  ↓
SORT size DESC
  ↓
LIMIT 20
```

Ou, em uma representação mais formal:

```text
Limit(
  Sort(
    Project(
      Filter(
        Filter(
          Scan(files),
          kind = 'file'
        ),
        name LIKE '%.js'
      ),
      [name, size]
    ),
    size DESC
  ),
  20
)
```

Isso é praticamente a essência de uma engine SQL.

O SQL é apenas uma linguagem conveniente para produzir essa árvore.

---

# 2. Os serviços mínimos que sua IODB precisa fornecer

Eu dividiria em **quatro níveis**.

## Nível 1 — Storage

Você já tem:

```js
table.scan()
table.get(pk)
table.path(path)
```

O mínimo conceitual é:

```js
source.scan()
source.get(key)
```

e idealmente:

```js
source.schema()
```

Exemplo:

```js
files.schema()
// {
//   id: 'string',
//   name: 'string',
//   kind: 'string',
//   size: 'number',
//   path: 'string'
// }
```

Isso é suficiente para começar.

---

# 3. Nível 2 — acesso eficiente

Aqui está onde sua arquitetura fica interessante.

Você já tem:

```text
primary key → O(1)
```

Então:

```sql
SELECT *
FROM files
WHERE id = 123;
```

não deveria virar:

```text
SCAN → FILTER
```

mas:

```text
LOOKUP(id, 123)
```

O planner pode transformar:

```text
Filter(
    Scan(files),
    id = 123
)
```

em:

```text
Lookup(files, id, 123)
```

Essa é a primeira otimização importante.

---

# 4. Índices são apenas outra forma de lookup

Por exemplo, se você possui:

```text
kind = file → [1, 2, 5, 8, 10...]
kind = dir  → [3, 4, 7, 9...]
```

então:

```sql
SELECT *
FROM files
WHERE kind = 'dir';
```

pode executar:

```js
index.lookup('kind', 'dir')
```

em vez de:

```js
scan().filter(x => x.kind === 'dir')
```

Conceitualmente:

```text
               predicate
                   │
          ┌────────▼────────┐
          │ predicate index │
          └────────┬────────┘
                   │
              [ids...]
                   │
             point lookup
                   │
                 rows
```

Isso combina perfeitamente com sua ideia anterior de índices como:

```text
value → array<id>
```

---

# 5. Nível 3 — operações relacionais

Aqui começa realmente a engine SQL.

Você precisa de poucas operações fundamentais:

```js
scan
filter
project
join
sort
group
aggregate
limit
offset
distinct
```

E elas podem ser extremamente simples.

### Filter

```js
filter(rows, predicate)
```

### Project

```js
project(rows, ['name', 'size'])
```

### Sort

```js
sort(rows, 'size', 'desc')
```

### Limit

```js
limit(rows, 20)
```

### Distinct

```js
distinct(rows, key)
```

### Join

```js
join(left, right, predicate)
```

### Group

```js
group(rows, key)
```

E agregações:

```js
count
sum
min
max
avg
```

Isso já permite uma quantidade enorme de SQL.

---

# 6. SQL não precisa operar sobre objetos "SQL"

Esse é um ponto particularmente importante para IODB.

Você não precisa transformar tudo em:

```text
SQLite page
B-tree
record
column slot
```

Pode continuar trabalhando diretamente com seus objetos:

```js
{
  id: 42,
  name: 'foo.js',
  kind: 'file',
  size: 1234
}
```

A relação SQL pode ser simplesmente:

```js
[
  { id: 1, name: 'a.js', kind: 'file' },
  { id: 2, name: 'b.txt', kind: 'file' }
]
```

Ou, melhor ainda, **um iterator lazy**.

---

# 7. O verdadeiro coração: iterator

Eu não faria:

```js
scan() → array
filter() → array
project() → array
sort() → array
```

porque isso cria cópias intermediárias.

A abstração fundamental pode ser algo próximo de:

```js
source.scan()
```

produzindo rows progressivamente.

Conceitualmente:

```text
Storage
   │
   ▼
 Scan iterator
   │
   ▼
 Filter iterator
   │
   ▼
 Project iterator
   │
   ▼
 Limit iterator
   │
   ▼
 Result
```

Assim:

```sql
SELECT name
FROM files
WHERE kind = 'file'
LIMIT 10;
```

pode parar depois dos primeiros 10 resultados.

Você não precisa percorrer os 1695 registros.

---

# 8. A engine inteira pode ser vista como uma árvore de operadores

Por exemplo:

```sql
SELECT name, size
FROM files
WHERE kind = 'file'
LIMIT 10;
```

vira:

```text
       LIMIT 10
           │
       PROJECT
       name,size
           │
        FILTER
      kind = file
           │
          SCAN
         files
```

E cada operador tem essencialmente uma interface:

```js
{
  open(),
  next(),
  close()
}
```

Isso é uma ideia central das engines relacionais.

Por exemplo:

```js
const filter = (input, test) => ({
  open: () => input.open(),
  next: () => {
    let row
    while (row = input.next())
      if (test(row)) return row
  }
})
```

Não precisa ser exatamente essa implementação, mas a ideia é essa.

---

# 9. O parser é uma preocupação diferente

O parser transforma:

```sql
SELECT name
FROM files
WHERE kind = 'file'
```

em algo como:

```js
{
  type: 'select',
  from: 'files',
  columns: ['name'],
  where: {
    op: '=',
    left: 'kind',
    right: 'file'
  }
}
```

Depois vem o planner.

O planner transforma isso em:

```js
{
  op: 'project',
  columns: ['name'],
  input: {
    op: 'filter',
    predicate: ['=', 'kind', 'file'],
    input: {
      op: 'scan',
      table: 'files'
    }
  }
}
```

E finalmente o executor interpreta isso.

---

# 10. Parser → AST → Plan → Execution

Essa separação é fundamental:

```text
SQL
 │
 ▼
Parser
 │
 ▼
AST
 │
 ▼
Semantic analysis
 │
 ▼
Logical plan
 │
 ▼
Optimizer
 │
 ▼
Physical plan
 │
 ▼
Executor
 │
 ▼
IODB
```

Por exemplo:

```sql
SELECT name
FROM files
WHERE id = 42;
```

### AST

```text
SELECT
 ├── columns: name
 ├── FROM: files
 └── WHERE:
       id = 42
```

### Plano lógico

```text
Project(name)
    │
Filter(id = 42)
    │
Scan(files)
```

### Plano físico otimizado

Como `id` é primary key:

```text
Project(name)
    │
Lookup(files, id=42)
```

O `Filter` desapareceu.

Isso é **query optimization**.

---

# 11. O planner é provavelmente onde sua engine pode ficar muito boa

Imagine:

```sql
SELECT *
FROM files
WHERE id = 123;
```

Você tem:

```text
PK lookup O(1)
```

Excelente.

Agora:

```sql
SELECT *
FROM files
WHERE kind = 'dir';
```

Você tem:

```text
kind index
```

Então:

```text
index lookup
```

Agora:

```sql
SELECT *
FROM files
WHERE size > 1000000;
```

Se não houver índice:

```text
scan + predicate
```

Se houver índice ordenado:

```text
range scan
```

A engine não precisa mudar.

Só muda o **access path**.

---

# 12. Isso leva a uma interface muito pequena para o storage

Eu tenderia a definir algo conceitualmente assim:

```js
table = {
  schema(),
  scan(),
  get(id),
  lookup(field, value),
  range(field, min, max)
}
```

Nem todos precisam existir.

O executor/planner pode descobrir capacidades:

```js
table.get
table.lookup
table.range
```

e escolher o melhor caminho.

Isso casa muito bem com sua filosofia de interfaces por capacidade.

---

# 13. O catálogo é outro serviço mínimo

SQL precisa saber o que existe.

Algo como:

```js
catalog.table('files')
catalog.tables()
catalog.schema('files')
```

Por exemplo:

```js
catalog.table('files')
```

retorna:

```js
{
  name: 'files',
  columns: {
    id: 'number',
    name: 'string',
    kind: 'string',
    size: 'number'
  },

  primaryKey: 'id',

  indexes: {
    kind: 'hash'
  }
}
```

Isso é o **catalog**.

Não precisa ser sofisticado.

---

# 14. Depois vêm expressões

Para executar:

```sql
WHERE size > 1000
```

você precisa avaliar expressões.

Um pequeno evaluator:

```text
literal
column
=
!=
<
<=
>
>=
AND
OR
NOT
IN
LIKE
IS NULL
```

Por exemplo:

```text
AND
├── =
│   ├── kind
│   └── "file"
└── >
    ├── size
    └── 1000
```

O evaluator recebe:

```js
row
```

e retorna:

```js
true | false
```

---

# 15. JOIN é o próximo grande salto

Considere:

```sql
SELECT users.name, orders.total
FROM users
JOIN orders ON orders.user_id = users.id;
```

A álgebra é:

```text
Join
├── users
└── orders
```

Existem várias estratégias.

### Nested loop

```text
para cada user
    procure orders
```

### Hash join

```text
orders
  ↓
hash(user_id)
  ↓
users
```

### Index join

Se `orders.user_id` tem índice:

```text
users
  ↓
para cada user
  ↓
orders.lookup(user_id)
```

E aqui novamente sua infraestrutura O(1) começa a ser muito valiosa.

---

# 16. GROUP BY é outro operador

```sql
SELECT kind, COUNT(*)
FROM files
GROUP BY kind;
```

vira:

```text
Aggregate
    │
   Group
  kind
    │
   Scan
```

Internamente:

```text
kind=file → count 240
kind=dir  → count 320
```

Não há muito mistério.

---

# 17. ORDER BY é especial

Porque normalmente exige materialização:

```sql
SELECT *
FROM files
ORDER BY size DESC;
```

Você precisa conhecer todas as linhas antes de saber qual vem primeiro.

Então:

```text
SCAN
 ↓
SORT
 ↓
RESULT
```

Aqui entra:

- sort em memória
- external sort se ficar grande
- índice ordenado, se disponível

Mas eu não implementaria external sort inicialmente.

---

# 18. O conjunto mínimo de SQL

Eu faria a primeira versão deliberadamente pequena:

```sql
SELECT
FROM
WHERE
LIMIT
OFFSET
ORDER BY
DISTINCT
```

Depois:

```sql
AND
OR
NOT
IN
LIKE
IS NULL
BETWEEN
```

Depois:

```sql
COUNT
SUM
MIN
MAX
AVG
GROUP BY
HAVING
```

Depois:

```sql
INNER JOIN
LEFT JOIN
```

Depois:

```sql
INSERT
UPDATE
DELETE
```

E só muito depois:

```text
subqueries
CTE
UNION
window functions
correlated subqueries
transactions
views
```

Você provavelmente não precisa de tudo isso para o primeiro objetivo.

---

# 19. E há uma distinção importante: SQL de leitura vs SQL transacional

Para sua engine, eu começaria **read-only**.

Porque:

```sql
SELECT ...
```

é essencialmente:

```text
parser
  ↓
planner
  ↓
iterator
  ↓
IODB
```

Já:

```sql
UPDATE ...
```

introduz:

```text
mutation
locking
atomicity
rollback
transaction
concurrency
durability
```

Isso é outro nível de complexidade.

---

# 20. Seu benchmark já mostra uma característica interessante

Seu resultado:

```text
                         iodb       sqlite

scan                    136.5 ms
corpus                   108.6       9.2
lookup PK                  0         0.1
lookup path                2         2.4
name ~ .js               0.3         0.2
kind = dir               0.2         0.2
```

sugere algo importante.

**Você não precisa competir com SQLite no storage.**

A parte:

```text
lookup
filter
predicate
```

já está praticamente no mesmo domínio de desempenho.

A diferença brutal está na:

```text
corpus construction
```

Ou seja, no custo de preparar os dados.

Isso reforça uma arquitetura onde:

```text
IODB
  ├── persistent data
  ├── primary indexes
  ├── secondary indexes
  └── metadata
          │
          ▼
       SQL engine
```

A engine SQL não deveria reconstruir um banco relacional.

Ela deveria **consultar a estrutura que já existe**.

---

# 21. A abstração mais interessante para IODB

Eu chegaria a uma interface ainda mais genérica:

```js
Source = {
  schema,
  scan,
  get,
  lookup,
  range
}
```

E uma query:

```js
query(source, plan)
```

Produziria um:

```js
Cursor
```

com:

```js
next()
```

Então:

```js
const files = db.table('files')

query(files, {
  select: ['name'],
  where: ['=', 'kind', 'file'],
  limit: 10
})
```

poderia ser executado sem SQL.

SQL seria simplesmente uma **frontend**:

```text
SQL frontend
      │
      ▼
     AST
      │
      ▼
   Planner
      │
      ▼
Relational operators
      │
      ▼
   IODB Source
```

E você poderia futuramente ter:

```text
SQL
SOML
API
CLI
programmatic query
```

todos produzindo o mesmo plano.

---

# 22. A arquitetura mínima que eu construiria

```text
sql/
├── lexer
├── parser
├── ast
├── catalog
├── expression
├── planner
├── optimizer
├── operators
│   ├── scan
│   ├── lookup
│   ├── filter
│   ├── project
│   ├── sort
│   ├── limit
│   ├── distinct
│   ├── join
│   └── aggregate
└── executor
```

Mas internamente pode ser muito menor do que parece.

O núcleo verdadeiro é:

```text
Lexer
Parser
Expression evaluator
Planner
Cursor
Operators
```

---

# 23. E a progressão pedagógica para construir uma engine

Se você quiser realmente entender SQL engines, eu seguiria esta ordem:

### Etapa 1 — linguagem

Implementar:

```sql
SELECT * FROM files
```

Depois:

```sql
SELECT name, size FROM files
```

Depois:

```sql
WHERE
```

Depois:

```sql
AND / OR
```

Você aprende **lexer + parser + AST**.

---

### Etapa 2 — álgebra

Implementar:

```text
Scan
Filter
Project
Limit
```

Agora:

```sql
SELECT name
FROM files
WHERE kind = 'file'
LIMIT 10;
```

vira uma árvore de execução.

Aqui você começa a entender o que uma engine realmente é.

---

### Etapa 3 — otimização

Transformar:

```text
Filter(pk = x)
    ↓
Scan
```

em:

```text
Lookup(pk, x)
```

Depois:

```text
Filter(indexed_field = x)
```

em:

```text
IndexLookup(field, x)
```

**Aqui sua IODB começa a se diferenciar.**

---

### Etapa 4 — operadores caros

Adicionar:

```text
Sort
Distinct
Group
Aggregate
```

Agora você entende materialização, memória e custo.

---

### Etapa 5 — JOIN

Implementar:

```text
Nested Loop
Hash Join
Index Join
```

Aqui você começa a entender de verdade **query planning**.

---

### Etapa 6 — mutations

Somente então:

```sql
INSERT
UPDATE
DELETE
```

E posteriormente:

```text
transaction
```

---

# 24. A ideia fundamental para guardar

Uma engine SQL pode ser reduzida conceitualmente a:

```text
              SQL
               │
             parse
               ▼
              AST
               │
             plan
               ▼
        relational algebra
               │
           optimize
               ▼
         physical plan
               │
            execute
               ▼
          data source
```

E a álgebra relacional essencial é surpreendentemente pequena:

```text
SCAN
FILTER
PROJECT
JOIN
SORT
GROUP
AGGREGATE
LIMIT
```

O resto é principalmente:

**linguagem + otimização + gerenciamento de execução.**

No seu caso, eu iria ainda mais longe: **IODB deveria expor uma interface de `Source`/`Cursor` e deixar o SQL ser apenas um dos consumidores dela.** Isso mantém o SQL pequeno e permite que SOML, APIs e consultas programáticas compartilhem exatamente o mesmo executor.

## Prompt:
9/11/2026, 12:14:08 AM

que tal se a gente usa closure funcions com com HOF e escopo compartilhado, para permitir coisas como select('users').where(is.equal('name','ana'))  //somewhat like. but each function call return a state node POJO that will build a greated projected state for the query. yet relational algeibraic mas functional.

## Response:
9/11/2026, 12:14:10 AM

Sim. **Acho que essa abordagem encaixa melhor no IODB do que reproduzir a arquitetura tradicional de uma engine SQL.** Você pode tratar a query como um **POJO funcional incremental**, e as HOFs como construtoras de planos.

A ideia central seria:

```js
select('users')
  .where(is.equal('name', 'ana'))
  .pick('id', 'email')
```

não executa nada. Cada chamada produz um novo estado:

```text
source
  ↓
where
  ↓
pick
```

mas todos os nós compartilham um mesmo closure/contexto.

## 1. Query como estado projetado

Eu imaginaria algo assim:

```js
const select = table => query({
  op: 'scan',
  table
})

const query = state => ({
  state,
  where: predicate => query({
    op: 'filter',
    predicate,
    input: state
  }),
  pick: (...fields) => query({
    op: 'project',
    fields,
    input: state
  }),
  limit: n => query({
    op: 'limit',
    n,
    input: state
  })
})
```

Conceitualmente, porém, eu **não faria cada node carregar um novo contexto inteiro**. O closure compartilhado pode manter o contexto da query:

```js
const select = table => {
  const ctx = {
    table,
    plan: { op: 'scan', table }
  }

  const q = plan => ({
    where: p => q(ctx.plan = {
      op: 'filter',
      predicate: p,
      input: plan
    }),

    pick: (...fields) => q(ctx.plan = {
      op: 'project',
      fields,
      input: plan
    })
  })

  return q(ctx.plan)
}
```

Mas isso já revela uma questão importante.

### Eu evitaria mutar `ctx.plan`.

Melhor:

```js
const select = table => {
  const ctx = { table }

  const q = plan => ({
    where: p => q({ op: 'filter', predicate: p, input: plan }),
    pick: (...fields) => q({ op: 'project', fields, input: plan }),
    limit: n => q({ op: 'limit', n, input: plan }),
    plan: () => plan
  })

  return q({ op: 'scan', table })
}
```

Agora temos exatamente o que você descreveu:

> cada chamada retorna um state node POJO que constrói um estado projetado maior.

---

# 2. E o interessante é que isso é álgebra relacional funcional

A representação:

```js
select('users')
  .where(is.equal('name', 'ana'))
  .pick('id', 'email')
  .limit(10)
```

pode ser:

```js
{
  op: 'limit',
  n: 10,
  input: {
    op: 'project',
    fields: ['id', 'email'],
    input: {
      op: 'filter',
      predicate: ['=', 'name', 'ana'],
      input: {
        op: 'scan',
        table: 'users'
      }
    }
  }
}
```

Ou seja:

```text
Query
  = Scan
  |> Filter
  |> Project
  |> Limit
```

Só que expressado como **composição funcional de estados**.

Isso é uma ótima combinação para sua arquitetura.

---

# 3. `is` pode ser outra família de HOFs

Por exemplo:

```js
is.equal('name', 'ana')
is.gt('age', 18)
is.like('name', 'A%')
is.and(
  is.equal('kind', 'file'),
  is.gt('size', 1000)
)
```

produz POJOs:

```js
is.equal('name', 'ana')
```

→

```js
{
  op: '=',
  field: 'name',
  value: 'ana'
}
```

Então:

```js
.where(is.equal('name', 'ana'))
```

é simplesmente:

```text
query state
      +
predicate POJO
      ↓
new query state
```

---

# 4. Mas eu faria `is` retornar funções, não somente AST

Aqui fica particularmente interessante.

Você pode ter:

```js
const equal = (field, value) => row => row[field] === value
```

Então:

```js
is.equal('name', 'ana')
```

é diretamente um predicate executável.

Mas você também pode querer introspecção para o planner.

Então o predicate pode carregar metadados:

```js
const equal = (field, value) => {
  const fn = row => row[field] === value
  return Object.assign(fn, {
    op: '=',
    field,
    value
  })
}
```

Agora ele é simultaneamente:

```text
callable predicate
        +
query expression
```

Isso é muito alinhado com sua ideia de **função/objeto absorvente**.

---

# 5. Melhor ainda: closure privado + POJO público

Eu vejo uma arquitetura muito bonita aqui:

```text
                 Query function
                       │
             ┌─────────┴─────────┐
             │ closure/context   │
             │                   │
             │ source            │
             │ capabilities      │
             │ execution         │
             └─────────┬─────────┘
                       │
                       ▼
                  state POJO
```

O POJO representa **o que a query é**.

O closure contém **como aquela query funciona**.

Isso evita contaminar o estado serializável com runtime.

Exatamente a separação que você já vem fazendo em SOML/Node:

```text
public semantic state
        ≠
private operational state
```

---

# 6. E você pode fazer o executor ser simplesmente outra HOF

Por exemplo:

```js
const execute = source => plan => ...
```

Então:

```js
execute(db)(query.plan())
```

ou, melhor, a própria query pode expor:

```js
query.run()
```

mantendo o executor no closure.

Algo como:

```js
const users = select('users')
  .where(is.equal('name', 'ana'))
  .pick('id', 'email')

users.run()
```

O importante é que `run()` seja **terminal**.

Até então:

```text
select
where
pick
order
limit
```

são somente construção.

---

# 7. Isso permite lazy execution naturalmente

```js
const q = select('files')
  .where(is.equal('kind', 'file'))
  .limit(10)
```

Nenhum arquivo foi lido.

Só existe:

```text
POJO plan
```

Quando:

```js
q.run()
```

o executor percorre:

```text
limit
 ↓
filter
 ↓
scan
```

e pode inclusive otimizar antes.

---

# 8. E aqui aparece uma vantagem enorme sobre AST SQL

Você pode fazer o planner receber **diretamente o mesmo POJO**:

```js
{
  op: 'filter',
  predicate: ...,
  input: ...
}
```

Não existe necessariamente:

```text
SQL
 ↓
AST
 ↓
IR
 ↓
logical plan
```

Para a API funcional:

```text
HOF
 ↓
plan POJO
```

Para SQL:

```text
SQL
 ↓
parser
 ↓
mesmo plan POJO
```

Portanto:

```text
                 SQL
                  │
               parser
                  │
                  ▼
              Query POJO
                  ▲
                  │
HOF API ──────────┘
                  │
                  ▼
               Planner
                  │
                  ▼
              Executor
```

**Isso é muito bom.**

---

# 9. E dá para tornar a álgebra quase literalmente funcional

Você poderia ter:

```js
scan('users')
filter(is.equal('name', 'ana'))
project('id', 'email')
limit(10)
```

como operadores puros:

```js
scan('users')
  |> filter(is.equal('name', 'ana'))
  |> project('id', 'email')
  |> limit(10)
```

Sem depender de pipe syntax, a API fica:

```js
select('users')
  .where(is.equal('name', 'ana'))
  .pick('id', 'email')
  .limit(10)
```

Mas semanticamente é:

```text
limit(
  project(
    filter(
      scan(users),
      equal(name, ana)
    ),
    id, email
  )
)
```

Isso é álgebra relacional funcional quase pura.

---

# 10. E o planner pode reescrever os POJOs

Suponha:

```js
select('users')
  .where(is.equal('id', 42))
  .pick('name')
```

Plano inicial:

```text
Project
  Filter(id = 42)
    Scan(users)
```

Planner:

```text
Project
  Lookup(users, id, 42)
```

Ou:

```js
{
  op: 'project',
  fields: ['name'],
  input: {
    op: 'lookup',
    table: 'users',
    key: 42
  }
}
```

O `Source` fornece a capacidade:

```js
users.get(42)
```

e pronto.

---

# 11. Isso também resolve JOIN de maneira elegante

Você poderia ter:

```js
select('users')
  .join(
    select('orders'),
    is.equal('users.id', 'orders.user_id')
  )
```

produzindo:

```js
{
  op: 'join',
  left: ...,
  right: ...,
  on: ...
}
```

Depois o planner decide:

```text
nested loop
hash join
index join
```

A API não precisa saber.

---

# 12. Eu faria uma distinção pequena, mas importante

Não chamaria tudo de `select`.

Internamente:

```text
source
relation
expression
query
plan
cursor
```

externamente, você pode ter a API agradável:

```js
select('users')
```

E conceitualmente:

```js
select()
```

significa:

> construa uma relação consultável a partir desta source.

Então:

```js
select('users')
  .where(...)
```

não é "executar SELECT".

É **construir uma relação derivada**.

Essa distinção fica muito útil quando começarem:

```js
const adults = select('users').where(is.gte('age', 18))

const active = adults.where(is.equal('active', true))

const result = active.pick('id', 'name')
```

As queries passam a ser **valores composáveis**.

---

## O modelo que eu adotaria

Bem minimalista:

```text
             ┌─────────────┐
             │   Source    │
             │ scan/get/...│
             └──────┬──────┘
                    │
                 select()
                    │
                    ▼
             ┌─────────────┐
             │ Query POJO  │◄──── HOFs
             └──────┬──────┘
                    │
              where/pick/...
                    │
                    ▼
             ┌─────────────┐
             │ Query Plan  │
             └──────┬──────┘
                    │
                optimize
                    │
                    ▼
             ┌─────────────┐
             │   Cursor    │
             └──────┬──────┘
                    │
                    ▼
                  rows
```

E a regra de ouro seria:

> **HOFs constroem semântica; POJOs representam semântica; closures carregam runtime; planner escolhe estratégia; cursor executa.**

Isso, para mim, é mais interessante que implementar uma "SQL engine" tradicional. Você estaria construindo uma **functional relational engine**, sobre o IODB, e SQL seria apenas uma das linguagens de entrada.

## Prompt:
9/11/2026, 12:23:50 AM

Qual é a ontologia básica com paralelos para sql, linq, activerecord, mongodb usam. para criarmos um conjunto de funções que possam sem componíveis (como operadores) de forma que as funcões recebam e retorner um array (variadic ou não) de nodes de uma query. A cadeia de chamadas só constroia a árvore de objetos. optimize() simplifica a árvore da query e run() executa e retorna a primeira página (4k)

## Response:
9/11/2026, 12:23:58 AM

Sim. Eu reduziria a ontologia a **relation → expression → operator → query → execution**. Os nomes de SQL/LINQ/ActiveRecord/MongoDB são diferentes, mas quase todos convergem para isso.

### 1. Ontologia comum

| Conceito | SQL | LINQ | ActiveRecord | MongoDB | IODB |
|---|---|---|---|---|---|
| fonte | `FROM users` | `users` | `User.all` | `db.users` | `source('users')` |
| seleção | `SELECT` | `Select` | `select` | projection | `pick` |
| filtro | `WHERE` | `Where` | `where` | query | `where` |
| ordenação | `ORDER BY` | `OrderBy` | `order` | `$sort` | `sort` |
| limite | `LIMIT` | `Take` | `limit` | `$limit` | `limit` |
| agrupamento | `GROUP BY` | `GroupBy` | `group` | `$group` | `group` |
| junção | `JOIN` | `Join` | `joins` | `$lookup` | `join` |
| agregação | `COUNT/SUM` | `Count/Sum` | `count/sum` | `$count/$group` | `count/sum` |
| união | `UNION` | `Concat` | `or` | `$unionWith` | `union` |

A ontologia mínima por baixo disso é:

```text
Source
  ↓
Relation
  ↓
Operator
  ↓
Expression
  ↓
Query Tree
  ↓
Optimized Tree
  ↓
Cursor/Page
```

Mas eu faria uma simplificação ainda maior:

> **Tudo que transforma uma sequência de nodes é um operator. Tudo que produz um valor booleano/valor derivado é uma expression.**

---

# 2. O contrato fundamental

A ideia que você propôs é muito boa:

```js
operator(...args) → Node[]
```

ou, mais precisamente, conceitualmente:

```js
operator(...nodes) → node
```

onde o `node` é um POJO da árvore.

Por exemplo:

```js
source('users')
```

produz:

```js
{
  op: 'source',
  name: 'users'
}
```

E:

```js
where(is.equal('name', 'ana'))
```

produz:

```js
{
  op: 'where',
  args: [
    { op: 'equal', args: ['name', 'ana'] }
  ]
}
```

A composição inteira é simplesmente construção de árvore.

---

# 3. Eu não faria `Query` como uma classe

Isso combina muito com sua abordagem de closure/HOF.

Algo conceitualmente assim:

```js
const query = node => Object.assign(node, {
  where: p => query({ op: 'where', args: [node, p] }),
  pick: (...x) => query({ op: 'pick', args: [node, ...x] }),
  sort: (...x) => query({ op: 'sort', args: [node, ...x] }),
  limit: n => query({ op: 'limit', args: [node, n] }),
  optimize: () => optimize(node),
  run: () => run(node)
})
```

Mas eu provavelmente **não colocaria os métodos no próprio POJO serializável**.

Melhor:

```text
POJO = semântica
closure = interface operacional
```

Então:

```js
select('users')
```

é um wrapper funcional sobre:

```js
{
  op: 'source',
  name: 'users'
}
```

---

# 4. A árvore deve ser uniforme

Eu usaria uma forma extremamente simples:

```js
{
  op: 'where',
  args: [
    {
      op: 'source',
      name: 'users'
    },
    {
      op: 'eq',
      args: ['name', 'ana']
    }
  ]
}
```

Ou:

```js
{
  op: 'pick',
  args: [
    {
      op: 'where',
      args: [
        { op: 'source', name: 'users' },
        { op: 'eq', args: ['name', 'ana'] }
      ]
    },
    'id',
    'name'
  ]
}
```

Isso é quase uma **AST universal de consulta**.

Não precisa distinguir artificialmente:

```text
SelectNode
WhereNode
FilterNode
ProjectionNode
...
```

O próprio:

```js
{ op, args }
```

já é suficiente.

---

# 5. A sacada: expressions também são operators

Por exemplo:

```js
is.equal('name', 'ana')
```

→

```js
{ op: 'eq', args: ['name', 'ana'] }
```

```js
is.gt('age', 18)
```

→

```js
{ op: 'gt', args: ['age', 18] }
```

```js
is.and(
  is.equal('kind', 'file'),
  is.gt('size', 1000)
)
```

→

```js
{
  op: 'and',
  args: [
    { op: 'eq', args: ['kind', 'file'] },
    { op: 'gt', args: ['size', 1000] }
  ]
}
```

Portanto você tem apenas uma ontologia:

```text
operator
   │
   ├── relation operators
   │     where
   │     pick
   │     sort
   │     join
   │     group
   │     limit
   │
   └── value operators
         eq
         gt
         add
         concat
         and
         or
         not
```

Isso é muito elegante.

---

# 6. `source()` é o ponto de entrada

Eu evitaria fazer:

```js
select('users')
```

ser semanticamente um `SELECT`.

Eu faria:

```js
from('users')
```

ou simplesmente:

```js
query('users')
```

Mas `select('users')` é perfeitamente aceitável como API fluida.

Internamente:

```js
source('users')
```

gera:

```js
{ op: 'source', args: ['users'] }
```

Então:

```js
select('users')
  .where(is.equal('name', 'ana'))
```

é apenas:

```text
source
  ↓
where
```

---

# 7. O conjunto inicial de operators

Eu começaria com este núcleo:

```text
source
where
pick
sort
limit
offset
distinct
join
group
aggregate
union
```

E expressions:

```text
eq
ne
lt
lte
gt
gte

and
or
not

in
between
like
isNull

add
sub
mul
div

coalesce
```

Isso já é uma linguagem de consulta extremamente expressiva.

---

# 8. `map`, `filter`, `reduce` aparecem naturalmente

E aqui entra o paralelo com programação funcional.

```js
query
  .map(...)
  .filter(...)
  .reduce(...)
```

é conceitualmente a mesma coisa que:

```text
PROJECT
FILTER
AGGREGATE
```

Mas eu **não usaria necessariamente os nomes JS**.

Porque:

```js
filter
```

é ótimo para programadores.

Porém:

```js
where
```

é melhor como DSL SQL.

Você pode ter aliases:

```js
where === filter
pick === select
```

se fizer sentido.

---

# 9. JOIN merece ser tratado como operator

Por exemplo:

```js
select('users')
  .join(
    select('orders'),
    is.equal('users.id', 'orders.user_id')
  )
```

Árvore:

```text
join
├── source(users)
├── source(orders)
└── eq(users.id, orders.user_id)
```

Depois o optimizer pode escolher:

```text
nested-loop
hash-join
index-join
```

A API não sabe nem precisa saber.

---

# 10. O `optimize()` é uma transformação da árvore

Isso é importante.

Não:

```js
optimize(query)
```

que executa coisas.

Mas:

```text
Query Tree
     │
     ▼
 optimize()
     │
     ▼
Optimized Query Tree
```

Exemplo:

```text
limit
  where id = 42
    source users
```

pode virar:

```text
limit
  lookup users pk=42
```

Ou:

```text
where kind = file
  source files
```

pode virar:

```text
indexLookup files.kind=file
```

---

# 11. E o optimizer pode ser uma coleção de pequenas rewrite functions

Essa é outra parte que acho muito alinhada ao seu estilo.

```js
const rules = [
  pushLimit,
  usePrimaryKey,
  useIndex,
  simplifyPredicates,
  mergeFilters,
  removeRedundantProjection
]
```

Cada uma:

```js
tree => tree
```

Então:

```js
optimize(tree)
```

é essencialmente uma sequência/fixpoint de transformações.

Exemplo:

```js
where(a).where(b)
```

pode virar:

```js
where(and(a, b))
```

E:

```js
where(true)
```

vira:

```js
input
```

E:

```js
where(false)
```

vira:

```js
empty
```

Isso transforma optimizer em algo bastante simples de testar.

---

# 12. `run()` não deveria retornar "a query"

Deve retornar um **cursor/página**.

Sua regra de 4 KB é interessante:

```js
q.run()
```

→ primeira página física/lógica de aproximadamente:

```text
4096 bytes
```

Então:

```js
{
  rows: [...],
  next: cursor
}
```

ou simplesmente um cursor que sabe continuar.

Eu manteria a abstração:

```text
Query
  ↓ run()
Cursor
  ↓
Page
```

Porque depois:

```js
q.run().next()
```

pode buscar a próxima página.

---

# 13. Isso cria uma separação muito limpa

```text
BUILD
────────────────────────

source()
where()
pick()
sort()
limit()
join()

       ↓

     TREE

OPTIMIZE
────────────────────────

optimize(tree)

       ↓

 OPTIMIZED TREE

EXECUTE
────────────────────────

run(tree)

       ↓

    CURSOR

       ↓

    PAGE 4K
```

**Nenhuma operação durante BUILD toca nos dados.**

Isso é uma propriedade excelente para testes.

---

# 14. E SQL passa a ser apenas um compilador

Por exemplo:

```sql
SELECT name, age
FROM users
WHERE age >= 18
ORDER BY name
LIMIT 20
```

vira:

```js
select('users')
  .where(is.gte('age', 18))
  .pick('name', 'age')
  .sort('name')
  .limit(20)
```

E ambas chegam ao mesmo tree:

```text
              limit 20
                  │
                sort
               name
                  │
               project
             name, age
                  │
                where
              age >= 18
                  │
               source
                users
```

Então:

```text
SQL ───────┐
           ├──→ Query Tree → optimize → run
LINQ ──────┤
           │
Mongo ─────┤
           │
IODB API ──┘
```

Essa é, na minha opinião, **a ontologia certa para o projeto**.

E há uma consequência especialmente interessante: se o seu `Node` já é um POJO semântico, essa query tree pode ser **SOML nativamente representável**, sem criar uma segunda estrutura conceitual para consultas.

## Prompt:
9/11/2026, 12:33:13 AM

que tal se partissemos dos nomes das entidades definidas (tabelas) como objetos públicos e todas as operações acontecem em uma stream de nodes e e calls encadeadas como:

```
 users // same as from('users')
  .pick('name', 'age')
  .gte('age', 18)
  .sort('name')
  .limit(20)
```

E cada chamada dessa está de fato somente se encadeando no colar.

## Response:
9/11/2026, 12:33:25 AM

Sim. E acho **mais natural** que `select('users')`.

A entidade pública já é a relação. A cadeia é simplesmente uma **stream de nodes de consulta**, e cada chamada adiciona um node ao colar.

```js
users
  .pick('name', 'age')
  .gte('age', 18)
  .sort('name')
  .limit(20)
```

A única ressalva: `gte('age', 18)` depois de `pick('name', 'age')` é semanticamente possível, mas a ordem física da cadeia não deveria necessariamente determinar a ordem de execução. Ela determina a **árvore declarativa**; `optimize()` decide a execução.

## O modelo

Eu faria cada entidade pública ser um `Query` inicial:

```js
users
```

semanticamente:

```js
{ op: 'source', name: 'users' }
```

E cada operação acrescenta um node:

```js
users.pick('name', 'age')
```

vira:

```js
{
  op: 'pick',
  args: ['name', 'age'],
  input: users
}
```

Depois:

```js
users
  .pick('name', 'age')
  .gte('age', 18)
```

vira:

```text
gte
└── pick
    └── users
```

Depois:

```text
limit 20
└── sort name
    └── gte age >= 18
        └── pick name, age
            └── users
```

Isso é literalmente uma **lista encadeada de operadores**, que depois pode ser tratada como árvore.

---

## Eu faria `gte` como operação de stream

Há uma distinção interessante:

```js
users.gte('age', 18)
```

não precisa significar "comparação".

Dentro de uma relation, significa:

```text
FILTER age >= 18
```

Enquanto:

```js
is.gte('age', 18)
```

poderia continuar significando uma expression:

```text
age >= 18
```

Então:

```js
users.gte('age', 18)
```

é açúcar para:

```js
users.where(is.gte('age', 18))
```

Isso permite uma API extremamente pequena.

---

# O conjunto de operadores fica muito elegante

### Relation operators

```js
users
  .pick('name', 'age')
  .where(...)
  .eq('status', 'active')
  .gte('age', 18)
  .sort('name')
  .limit(20)
```

### Expressions

```js
is.eq(...)
is.ne(...)
is.gt(...)
is.gte(...)
is.lt(...)
is.lte(...)
is.and(...)
is.or(...)
is.not(...)
is.in(...)
is.like(...)
```

### Composição

```js
users
  .where(
    is.and(
      is.gte('age', 18),
      is.eq('status', 'active')
    )
  )
```

Mas para o caso simples:

```js
users.gte('age', 18)
```

é melhor.

---

# O "colar" pode ser literalmente um closure

A implementação conceitual pode ser minúscula:

```js
const query = node => new Proxy(node, {
  get: (_, op) => (...args) => query({ op, args, input: node })
})
```

Então:

```js
users
  .pick('name', 'age')
  .gte('age', 18)
  .sort('name')
  .limit(20)
```

constrói:

```js
{
  op: 'limit',
  args: [20],
  input: {
    op: 'sort',
    args: ['name'],
    input: {
      op: 'gte',
      args: ['age', 18],
      input: {
        op: 'pick',
        args: ['name', 'age'],
        input: {
          op: 'source',
          name: 'users'
        }
      }
    }
  }
}
```

**Nenhum dado foi acessado.**

Isso é a propriedade mais importante da arquitetura.

---

# Mas eu faria uma pequena mudança

Não usaria necessariamente `input`.

Usaria:

```js
{
  op: 'limit',
  args: [20],
  in: {
    ...
  }
}
```

Porque depois alguns operadores têm múltiplas entradas:

```text
join
├── left
└── right
```

Ou podemos generalizar:

```js
{
  op: 'join',
  args: [...],
  inputs: [...]
}
```

Então a ontologia pode ser:

```js
{
  op,
  args,
  in
}
```

para unary stream operators, e:

```js
{
  op,
  args,
  in: [...]
}
```

para operadores multi-stream.

---

# E `optimize()` é onde a mágica acontece

Sua cadeia:

```js
users
  .pick('name', 'age')
  .gte('age', 18)
  .sort('name')
  .limit(20)
```

não precisa ser executada nessa ordem.

O optimizer pode enxergar:

```text
LIMIT
  SORT
    FILTER age >= 18
      PROJECT name, age
        SOURCE users
```

e decidir:

```text
SOURCE users
    ↓
FILTER age >= 18
    ↓
PROJECT name, age
    ↓
SORT name
    ↓
LIMIT 20
```

Ou até detectar índice:

```text
SOURCE users
    ↓
INDEX RANGE age >= 18
    ↓
PROJECT name, age
    ↓
SORT name
    ↓
LIMIT 20
```

E, se existir índice `(age, name)`, potencialmente:

```text
INDEX SCAN age >= 18 ORDER BY name
    ↓
PROJECT
    ↓
LIMIT 20
```

A API continua exatamente igual.

---

# Isso também resolve a questão de "SQL order"

Você não precisa fazer:

```js
users
  .where(...)
  .pick(...)
```

obrigatoriamente.

Pode escrever:

```js
users
  .pick(...)
  .where(...)
```

porque o objeto não é uma pipeline imperativa.

É uma **query declarativa construída incrementalmente**.

A cadeia é apenas uma maneira agradável de construir a árvore.

---

# E `run()` é o único ponto que cruza a fronteira

Eu deixaria:

```js
const q = users
  .pick('name', 'age')
  .gte('age', 18)
  .sort('name')
  .limit(20)

const page = q.run()
```

Com:

```text
              BUILD
                │
users ──► pick ─► gte ─► sort ─► limit
                │
                ▼
             optimize
                │
                ▼
              PLAN
                │
                ▼
               run
                │
                ▼
             Page 4K
```

E, crucialmente:

```js
q.optimize()
```

também não executa nada.

Ele simplesmente retorna outra query:

```text
Query → Query
```

Então:

```js
q.optimize().run()
```

é perfeitamente natural.

---

## A ontologia resultante

Eu reduziria tudo a isto:

```text
ENTITY
  │
  ▼
STREAM
  │
  ├── filter operators
  │     eq ne gt gte lt lte like in ...
  │
  ├── shape operators
  │     pick map distinct
  │
  ├── ordering
  │     sort
  │
  ├── cardinality
  │     limit offset
  │
  ├── relational
  │     join union
  │
  └── aggregation
        group count sum avg min max
```

Cada operador:

```text
Stream → Stream
```

com exceção das expressões, que são:

```text
Node → Value
```

e dos terminais:

```text
Stream → Page
```

O mais bonito é que **SQL, MongoDB e LINQ podem todos compilar para exatamente essa mesma linguagem interna**.

E a API IODB pode ser a linguagem nativa:

```js
users
  .gte('age', 18)
  .pick('name', 'age')
  .sort('name')
  .limit(20)
  .optimize()
  .run()
```

Isso está ficando menos como "implementar SQL" e mais como construir uma **pequena álgebra funcional de streams de Nodes**, sobre a qual SQL se torna apenas um frontend. Acho que esse é o caminho certo para o IODB.

## Prompt:
9/11/2026, 12:38:20 AM

de fato is.gte é melhor que gte isolado, pq é um filter node e is funciona como um encadeador de condições booleanas. mas que pode ser omitido por sugar.

## Response:
9/11/2026, 12:38:27 AM

Exato. Eu separaria claramente **expressão** de **operador de stream**, e `is` seria o namespace das expressões.

```js
users
  .where(is.gte('age', 18))
  .where(is.eq('status', 'active'))
```

A árvore seria:

```text
where
└── and
    ├── gte(age, 18)
    └── eq(status, active)
```

Mas o sugar:

```js
users
  .gte('age', 18)
  .eq('status', 'active')
```

pode simplesmente ser compilado para:

```js
users.where(
  is.and(
    is.gte('age', 18),
    is.eq('status', 'active')
  )
)
```

Ou, melhor ainda, o sugar pode ser **acumulado estruturalmente** pelo builder e só materializado como `and` quando necessário.

### `is` seria uma pequena álgebra booleana

```js
is.eq(a, b)
is.ne(a, b)
is.gt(a, b)
is.gte(a, b)
is.lt(a, b)
is.lte(a, b)

is.and(...)
is.or(...)
is.not(...)
is.in(...)
is.like(...)
is.null(...)
```

Todos retornam **expression nodes**:

```js
is.gte('age', 18)
```

→

```js
{ op: 'gte', args: ['age', 18] }
```

E:

```js
is.and(
  is.gte('age', 18),
  is.lt('age', 65)
)
```

→

```js
{
  op: 'and',
  args: [
    { op: 'gte', args: ['age', 18] },
    { op: 'lt', args: ['age', 65] }
  ]
}
```

Isso deixa uma distinção muito limpa:

```text
Query operators
────────────────
where
pick
sort
limit
join
group
...

Expression operators
────────────────────
is.eq
is.gte
is.and
is.or
is.not
...
```

E o açúcar:

```js
users.gte('age', 18)
```

é apenas:

```js
users.where(is.gte('age', 18))
```

enquanto:

```js
users.gte('age', 18).lt('age', 65)
```

é:

```js
users.where(
  is.and(
    is.gte('age', 18),
    is.lt('age', 65)
  )
)
```

Isso dá uma propriedade importante à API: **a forma explícita e a forma sugar produzem exatamente a mesma árvore semântica**. Portanto o optimizer não precisa saber se a query veio de SQL, da API fluente ou do sugar.

## Prompt:
9/11/2026, 12:42:25 AM

a simple regex parser to convert

```
users.where('age > 18 && status=atictive') // seguindo convenoes js
into
users
  .where(is.gte('age', 18))
  .where(is.eq('status', 'active'))
```

## Response:
9/11/2026, 12:42:31 AM

Sim. E eu faria o parser **intencionalmente limitado**: não tentar parsear JavaScript; apenas uma gramática de predicates com sintaxe JS.

A entrada:

```js
users.where('age > 18 && status = "active"')
```

pode virar diretamente:

```js
users
  .where(is.gte('age', 18))
  .where(is.eq('status', 'active'))
```

Mas há uma distinção importante: `&&` deve virar **dois `where()`**, enquanto `||` deve permanecer um único `where(is.or(...))`.

### Gramática mínima

```text
expr  := term ( "&&" term )*
term  := factor ( "||" factor )*
factor := field op value
op    := == | = | != | > | >= | < | <=
value := number | "string" | 'string' | true | false | null
```

Assim:

```js
'age > 18 && status = "active"'
```

vira:

```js
[
  ['gte', 'age', 18],
  ['eq', 'status', 'active']
]
```

e:

```js
'age > 18 || status = "active"'
```

vira:

```js
[
  ['or',
    ['gte', 'age', 18],
    ['eq', 'status', 'active']
  ]
]
```

### O parser pode ser pequeno

```js
const parseValue = x => {
  x = x.trim()
  if (/^-?\d+(\.\d+)?$/.test(x)) return Number(x)
  if (/^(true|false|null)$/.test(x)) return JSON.parse(x)
  return x.replace(/^['"]|['"]$/g, '')
}

const parse = s =>
  s.split(/\s*&&\s*/).map(group => {
    const parts = group.split(/\s*\|\|\s*/)
    if (parts.length > 1)
      return ['or', ...parts.map(parseTerm)]
    return parseTerm(group)
  })

const parseTerm = s => {
  const [, field, op, value] =
    s.match(/^\s*([\w.]+)\s*(==|=|!=|>=|<=|>|<)\s*(.*?)\s*$/) || []

  if (!field) throw Error(`Invalid predicate: ${s}`)

  return [({ '=': 'eq', '==': 'eq', '!=': 'ne',
    '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' })[op],
    field, parseValue(value)]
}
```

Mas eu faria uma etapa seguinte que transforma isso em `is`:

```js
const expr = ([op, ...args]) => is[op](...args)

const where = s =>
  parse(s).map(expr)
```

Então:

```js
users.where('age > 18 && status = "active"')
```

pode ser sugar para:

```js
users
  .where(is.gte('age', 18))
  .where(is.eq('status', 'active'))
```

### Porém, eu mudaria uma coisa na sua proposta

Não faria o parser produzir **calls**. Ele deveria produzir **nodes**:

```js
parse('age > 18 && status = "active"')
```

→

```js
[
  { op: 'gte', args: ['age', 18] },
  { op: 'eq', args: ['status', 'active'] }
]
```

E então `is.gte()` e o parser usam o **mesmo formato interno**.

Isso mantém a arquitetura:

```text
                 ┌── is.gte()
                 │
SQL ── parser ───┼── expression node
                 │
where('...') ────┘
                       │
                       ▼
                  Query Tree
```

Ou seja, `is` não é uma etapa necessária do sistema; é uma **DSL conveniente para construir os mesmos nodes**.

E eu manteria esse parser deliberadamente burro no início. Quando aparecer necessidade de parênteses, `IN`, `LIKE`, funções etc., aí vale trocar os `split()` por um lexer/parser pequeno. Não vale transformar essa primeira versão num parser de JS.

## Prompt:
9/11/2026, 12:46:33 AM

sim. produz nodes. as calls são formas de fazer o mesmo. e ele deve seguir um dialeto familiar sql. por isso eu pedi para usar regex para poder ser 'burro' e servir basicamente como um recursive expression caller com infix operator. se os operadores são conhecidos, o dirty parser da rpova de conceito não é dificil.

## Response:
9/11/2026, 12:46:37 AM

Exatamente. O ponto importante é separar **sintaxe de construção** de **semântica**.

As calls:

```js
users.where(is.gte('age', 18))
users.gte('age', 18)
```

e a expressão textual:

```js
users.where('age >= 18')
```

não são três mecanismos diferentes. **Todas produzem os mesmos nodes.**

O parser pode ser propositalmente burro: ele só precisa reconhecer um pequeno conjunto de operadores conhecidos e transformar a expressão infix em uma árvore de chamadas.

Por exemplo:

```js
'age >= 18 && status = "active"'
```

vira semanticamente:

```js
is.and(
  is.gte('age', 18),
  is.eq('status', 'active')
)
```

ou, se quisermos preservar a forma relacional:

```js
where(is.gte('age', 18))
where(is.eq('status', 'active'))
```

Mas internamente o resultado é simplesmente:

```js
{
  op: 'and',
  args: [
    { op: 'gte', args: ['age', 18] },
    { op: 'eq',  args: ['status', 'active'] }
  ]
}
```

### O parser pode ser quase um `eval` sem eval

A ideia que você está apontando é boa:

```text
texto
  ↓
tokens conhecidos
  ↓
recursive expression caller
  ↓
nodes
```

Com uma tabela de operadores:

```js
const ops = {
  '==': 'eq',
  '=':  'eq',
  '!=': 'ne',
  '>':  'gt',
  '>=': 'gte',
  '<':  'lt',
  '<=': 'lte',
  '&&': 'and',
  '||': 'or'
}
```

E cada operador conhecido sabe como combinar seus operandos:

```js
const node = (op, ...args) => ({ op, args })
```

Então:

```js
parse('age >= 18')
```

produz:

```js
node('gte', 'age', 18)
```

e:

```js
parse('age >= 18 && status = "active"')
```

produz:

```js
node('and',
  node('gte', 'age', 18),
  node('eq', 'status', 'active')
)
```

Isso é suficiente para uma **proof of concept extremamente pequena**.

E o mais interessante é que o parser não precisa conhecer `users`, índices, schema, IODB ou execução. Ele só conhece **expressões e operadores**.

Assim temos três frontends equivalentes:

```js
users.where(is.gte('age', 18))
```

```js
users.gte('age', 18)
```

```js
users.where('age >= 18')
```

→

```js
{
  op: 'where',
  in: {
    op: 'source',
    name: 'users'
  },
  args: [
    {
      op: 'gte',
      args: ['age', 18]
    }
  ]
}
```

Esse é provavelmente o desenho certo para o IODB: **SQL-like na superfície, nodes no núcleo**. SQL completo pode depois ser apenas mais um parser para o mesmo IR.

## Prompt:
9/11/2026, 12:55:08 AM

sim e acho que podemos começar retorna um Proxy para uma entidade. e então.
const users = IO.from('users')
const activeUsers = users.status('active')
const activeFromNY = activeUsers.state('NY')
const  activeFromNY() // retrieve the data , the same a .run()
and so on. queries as true parametric queries e os proxy resolvem as propriedade de forma lazy. Pense nisso para views inserts, updates, business rules and proceudures. alll inside js with function as data.

## Response:
9/11/2026, 12:55:11 AM

Sim. Isso leva o desenho para algo mais interessante que um simples query builder: **a entidade é um objeto/proxy semântico, e cada acesso/conexão constrói uma função paramétrica que só é materializada quando chamada**.

Eu estruturaria o núcleo assim:

```js
const users = IO.from('users')

const activeUsers  = users.status('active')
const activeFromNY = activeUsers.state('NY')

activeFromNY()       // execute
activeFromNY.run()   // mesmo efeito
```

Conceitualmente:

```text
IO.from('users')
     │
     ▼
  source(users)
     │
     ├── status('active')
     │
     ▼
   where(eq(status, 'active'))
     │
     ├── state('NY')
     │
     ▼
   where(eq(state, 'NY'))
     │
     ▼
   execute()
```

Mas há uma consequência importante: **`status` e `state` não precisam existir como métodos reais**.

O Proxy resolve qualquer propriedade lazily:

```js
users.status
```

vira semanticamente algo como:

```js
users.field('status')
```

e a chamada:

```js
users.status('active')
```

vira:

```js
users.where(is.eq('status', 'active'))
```

Portanto o Proxy funciona quase como uma **linguagem de consulta embutida em JavaScript**.

### E a chamada final é apenas outro operador

Eu evitaria tratar `run()` como algo muito especial:

```js
activeFromNY()
```

pode simplesmente ser o terminal:

```js
run(activeFromNY)
```

com o próprio Proxy fornecendo o `apply`.

Assim:

```js
const q = IO.from('users')
  .status('active')
  .state('NY')

q()
q.run()
```

são duas formas da mesma coisa.

### O ponto realmente poderoso

Isso permite que **função seja dado** em todo o sistema.

Uma query:

```js
const activeNY = users
  .status('active')
  .state('NY')
```

não contém os usuários.

Ela contém algo próximo de:

```js
{
  op: 'where',
  args: [{ op: 'eq', args: ['state', 'NY'] }],
  in: {
    op: 'where',
    args: [{ op: 'eq', args: ['status', 'active'] }],
    in: {
      op: 'source',
      args: ['users']
    }
  }
}
```

E pode ser parametrizada:

```js
const usersFrom = state =>
  users
    .status('active')
    .state(state)

usersFrom('NY')()
usersFrom('CA')()
usersFrom('TX')()
```

Ou, ainda melhor, parâmetros podem permanecer como nodes:

```js
const usersFrom = users.state($state)
```

e depois:

```js
usersFrom({ state: 'NY' })
```

Isso começa a parecer uma **linguagem funcional de dados**, não apenas SQL em JavaScript.

### E isso generaliza muito bem

O mesmo mecanismo pode produzir:

```js
const activeUsers = users.status('active')
```

**view:**

```js
const activeUsers = users
  .status('active')
  .pick('id', 'name')
```

**insert:**

```js
users.insert({
  name: $name,
  status: 'active'
})
```

**update:**

```js
users
  .status('pending')
  .update({ status: 'active' })
```

**delete:**

```js
users
  .status('deleted')
  .remove()
```

**business rule:**

```js
const canActivate =
  user => user.status === 'pending'
       && user.email != null
```

ou, mantendo tudo como dados executáveis:

```js
const canActivate =
  users.status('pending')
       .email.notNull()
```

**procedure:**

```js
const activate = user =>
  users.id(user.id).update({
    status: 'active'
  })
```

E uma procedure passa a ser literalmente uma função JS que compõe operações IODB.

### A distinção que eu manteria

Há três níveis, mas todos podem compartilhar o mesmo mecanismo:

```text
             JavaScript
                 │
       ┌─────────┴─────────┐
       │                   │
    functions            Proxy
       │                   │
       └─────────┬─────────┘
                 ▼
             Node / IR
                 │
          optimize()
                 │
             execute()
                 │
                IODB
```

Então:

- **Proxy** = sintaxe lazy;
- **functions** = composição/parametrização;
- **nodes** = verdade semântica;
- **optimizer** = transformação;
- **IODB** = execução/persistência.

Isso também explica por que eu não faria `users.status('active')` executar absolutamente nada. **Até o `()` final, tudo é apenas construção de uma função/query.**

E o parser regex que discutimos entra naturalmente como **mais um construtor de nodes**:

```js
users.where('status = "active" && state = "NY"')
```

e:

```js
users.status('active').state('NY')
```

chegam ao mesmo IR.

Esse desenho é pequeno o suficiente para implementar primeiro e, ao mesmo tempo, tem espaço para crescer até **views, CRUD, regras e procedures sem criar uma segunda linguagem separada**.

## Prompt:
9/11/2026, 1:02:40 AM

exato eu penso uma dx da seguinte forma
db = IO('mydb/') // retorna um proxy para um diretorio
db.users // deve resolver mydb/users.table.json e a partir disso todo o resto
seguindo este exato modelo. o proxy antecipa a resolução e retorna um node. este node é um callable. vamos pensar na DX inteira minimalista e completa como deve.

## Response:
9/11/2026, 1:02:44 AM

Sim. Eu acho que a DX deve partir exatamente desse princípio:

> **`IO(path)` abre um espaço semântico. O Proxy navega nesse espaço. Cada navegação produz um node callable. Nada é resolvido materialmente até a execução.**

Isso permite manter a API inteira extremamente pequena.

### 1. O ponto de entrada

```js
const db = IO('mydb/')
```

`db` é um Proxy para o diretório.

```js
db.users
```

não lê necessariamente o arquivo. O Proxy **antecipa** que `users` representa:

```text
mydb/users.table.json
```

e produz um node:

```js
{
  op: 'source',
  name: 'users',
  path: 'mydb/users.table.json'
}
```

Só que esse node é callable.

```js
db.users()
```

executa a source.

---

# A DX mínima

Eu tentaria fazer com que praticamente tudo possa ser expresso através destas operações:

```text
IO()
  .property
  (...)
  .property(...)
  .where(...)
  .pick(...)
  .sort(...)
  .group(...)
  .join(...)
  .insert(...)
  .update(...)
  .delete(...)
  .run()
```

Mas `property` não precisa ser uma operação explícita.

## Navegação vira filtro

```js
db.users.status('active')
```

é:

```js
db.users.where(is.eq('status', 'active'))
```

e:

```js
db.users.status('active').state('NY')
```

é:

```js
db.users
  .where(is.eq('status', 'active'))
  .where(is.eq('state', 'NY'))
```

O interessante é que:

```js
db.users.status
```

pode ser simplesmente um **field node**.

Então:

```js
db.users.status.eq('active')
```

também poderia funcionar.

Mas eu tenderia a fazer:

```js
db.users.status('active')
```

como açúcar para igualdade, porque é a DX mais limpa.

---

# 2. Operadores relacionais

Eu manteria uma pequena gramática familiar:

```js
db.users.status('active')
db.users.age.gte(18)
db.users.age.lt(30)
db.users.name.like('And%')
```

equivalentes a:

```js
db.users.where(is.eq('status', 'active'))
db.users.where(is.gte('age', 18))
db.users.where(is.lt('age', 30))
db.users.where(is.like('name', 'And%'))
```

E ainda:

```js
db.users.where('age >= 18 && status = "active"')
```

O parser "burro" produz exatamente os mesmos nodes.

---

# 3. `is` como linguagem de expressão

Eu manteria `is` porque ele resolve elegantemente a parte mais complicada da linguagem:

```js
is.eq(...)
is.ne(...)
is.gt(...)
is.gte(...)
is.lt(...)
is.lte(...)
is.in(...)
is.like(...)
is.null(...)
is.and(...)
is.or(...)
is.not(...)
```

Por exemplo:

```js
db.users.where(
  is.and(
    is.gte('age', 18),
    is.eq('state', 'NY')
  )
)
```

E o Proxy permite a forma DX:

```js
db.users
  .age.gte(18)
  .state('NY')
```

As duas formas convergem.

---

# 4. O node é uma função

Este é provavelmente o ponto central da arquitetura.

```js
const q = db.users
  .status('active')
  .state('NY')
```

`q` não é resultado.

É um **programa parametrizado**.

Então:

```js
q()
```

executa.

E:

```js
q.run()
```

é apenas uma forma explícita da mesma coisa.

Eu faria ambos:

```js
q() === q.run()
```

conceitualmente.

Isso também permite:

```js
const users = db.users

users()
users.limit(20)()
users.status('active')()
```

---

# 5. `pick`, `sort`, `limit`

A parte relacional permanece explícita:

```js
db.users
  .status('active')
  .pick('id', 'name', 'email')
  .sort('name')
  .limit(20)()
```

Ou:

```js
db.users
  .pick('id', 'name', 'email')
  .sort('-name')
  .limit(20)
```

Eu usaria `-name` para descending porque é extremamente compacto, mas também podemos aceitar:

```js
.sort('name', 'desc')
```

---

# 6. Parâmetros

Aqui a ideia fica realmente interessante.

Uma query pode ser uma função:

```js
const usersFrom = state =>
  db.users
    .status('active')
    .state(state)
```

Então:

```js
usersFrom('NY')()
usersFrom('CA')()
```

Não precisamos inventar um sistema de prepared statements separado.

**JavaScript já é o sistema de parametrização.**

Mas podemos também ter parâmetros semânticos:

```js
const usersFrom =
  db.users
    .status('active')
    .state($state)
```

e:

```js
usersFrom({ state: 'NY' })()
```

Isso é útil para SQL/string queries, cache e procedures.

---

# 7. Insert

A mesma linguagem pode continuar sem uma API paralela:

```js
db.users.insert({
  name: 'Alice',
  age: 30,
  state: 'NY'
})()
```

Ou simplesmente:

```js
db.users.in({
  name: 'Alice',
  age: 30
})()
```

Eu prefiro `insert` para a DX pública porque não há ambiguidade.

Mas internamente:

```js
{
  op: 'insert',
  in: {
    op: 'source',
    name: 'users'
  },
  args: [{
    name: 'Alice',
    age: 30
  }]
}
```

---

# 8. Update

```js
db.users
  .status('pending')
  .update({
    status: 'active'
  })()
```

O filtro continua sendo construído exatamente como uma query.

Isso é importante:

```js
db.users.status('pending')
```

não sabe nem precisa saber se será usado para:

```js
()
.pick(...)
.update(...)
.delete(...)
```

É simplesmente um relation node.

---

# 9. Delete

```js
db.users
  .status('deleted')
  .remove()()
```

Eu provavelmente usaria `delete()` semanticamente, mas `delete` é palavra reservada em certas posições/contextos de JS. Então:

```js
.remove()
```

é uma DX mais confortável.

---

# 10. Views

Uma view é simplesmente guardar um node:

```js
const activeUsers =
  db.users
    .status('active')
    .pick('id', 'name')
```

Depois:

```js
activeUsers()
```

ou continuar compondo:

```js
activeUsers
  .state('NY')
  .sort('name')()
```

E uma view persistida poderia ser:

```js
db.view('activeUsers', activeUsers)
```

Mas talvez nem precisemos disso inicialmente.

---

# 11. Joins

O mesmo princípio:

```js
db.orders
  .join(db.users, 'userId')
  .status('active')
```

ou uma forma mais explícita:

```js
db.orders.join(
  db.users,
  is.eq('orders.userId', 'users.id')
)
```

Produz:

```js
{
  op: 'join',
  in: [
    orders,
    users
  ],
  args: [
    {
      op: 'eq',
      args: ['orders.userId', 'users.id']
    }
  ]
}
```

Não há necessidade de um mecanismo especial de "query join".

É só outro node.

---

# 12. Agregações

Mesma ideia:

```js
db.orders
  .group('customerId')
  .sum('total')
```

ou:

```js
db.orders
  .group('customerId')
  .count()
```

E posteriormente:

```js
db.orders
  .group('customerId')
  .sum('total')
  .sort('-total')
  .limit(10)()
```

---

# 13. Arquivos e diretórios

Aqui eu faria uma distinção importante.

```js
const db = IO('mydb/')
```

é um namespace.

Então:

```js
db.users
db.orders
db.products
```

são entidades.

Mas o mesmo Proxy poderia navegar:

```js
db.logs
db.config
db.cache
```

dependendo da extensão/metadado encontrado.

A resolução pode ser:

```text
db.users
   │
   ├── users.table.json
   ├── users.table.jsonl
   ├── users.json
   └── users/
```

com uma política determinística.

Ou, mais simples para a primeira versão:

```text
db.users → mydb/users.table.json
```

e acabou.

Depois o resolver pode crescer.

---

# 14. SQL é só outra porta

Isso fecha muito bem com o que discutimos.

```js
db.users
  .status('active')
  .age.gte(18)
  .pick('name', 'age')
  .sort('name')
  .limit(20)
```

e:

```sql
SELECT name, age
FROM users
WHERE status = 'active'
  AND age >= 18
ORDER BY name
LIMIT 20
```

produzem o mesmo IR.

Portanto:

```text
Proxy API ──────┐
                │
SQL parser ─────┤
                ├──→ Query Nodes → optimize → run
JS expression ──┤
                │
future API ─────┘
```

---

# 15. Business rules e procedures

Aqui eu acho que a arquitetura fica especialmente forte.

Uma regra:

```js
const canActivate =
  user =>
    user.status === 'pending' &&
    user.email != null
```

continua sendo JS normal.

Uma procedure:

```js
const activate = id =>
  db.users
    .id(id)
    .update({ status: 'active' })()
```

é simplesmente uma função.

Uma operação composta:

```js
const activateUser = id => {
  const user = db.users.id(id).one()

  if (!user)
    return false

  if (!canActivate(user))
    return false

  return db.users
    .id(id)
    .update({ status: 'active' })()
}
```

Não precisamos inventar `CREATE PROCEDURE`.

**JS é a linguagem procedural. O IODB é a linguagem de dados.**

---

# 16. O núcleo pode ser surpreendentemente pequeno

Eu imagino algo nessa linha:

```js
const IO = path => namespace(path)

const namespace = path =>
  new Proxy(node('namespace', path), handler)

const handler = {
  get(node, key) {
    if (key === 'run') return () => run(node)
    if (key === 'optimize') return () => optimize(node)
    if (key === 'then') return undefined

    return (...args) =>
      build(node, key, args)
  },

  apply(node, _, args) {
    return run(node, args)
  }
}
```

A implementação real teria algumas distinções entre:

```text
namespace
source
field
expression
relation
mutation
terminal
```

mas **a superfície pode continuar sendo basicamente Proxy + nodes**.

E isso preserva uma coisa que considero fundamental no seu desenho:

> **não existe uma grande classe Query.**

Existe um conjunto pequeno de nodes e uma máquina de resolução.

O Proxy fornece a DX.

As funções fornecem composição.

Os nodes fornecem a semântica.

O optimizer transforma nodes.

O executor materializa nodes.

E o storage simplesmente atende às operações físicas que o plano pedir.

Essa é uma base boa para começar a implementar, porque podemos testar a DX primeiro **sem IODB real**: construir `db.users.status('active').state('NY').limit(20)` e verificar somente o node produzido. Depois colocamos `optimize()` e, por último, `run()`.

## Prompt:
9/11/2026, 1:30:44 AM

exato. vamos fazer isso em um diretorio de tabelas virtuais que implementam uma interface esperada minima sobre o qual o algebra de funcoes e nós relacionais podem operar. idealmente a inteface basica deve ser table or schema.

## Response:
9/11/2026, 1:30:50 AM

Sim. Eu faria essa separação de forma bem explícita:

```text
IO directory
    │
    ├── users ──────→ Table
    ├── orders ──────→ Table
    └── products ────→ Table
                         │
                         ▼
                  relational algebra
                         │
                         ▼
                       Nodes
                         │
                    optimize()
                         │
                       run()
```

E a interface `Table` deve ser **a menor abstração que o álgebra precisa**, não uma representação específica de arquivo.

### Interface mínima

Eu começaria praticamente só com:

```js
Table = {
  schema,
  scan,
  get,
}
```

Conceitualmente:

```js
const table = {
  schema() {},
  scan() {},
  get(key) {}
}
```

Onde:

```js
schema()
```

descreve a entidade:

```js
{
  id: 'string',
  name: 'string',
  age: 'number',
  state: 'string',
  status: 'string'
}
```

e:

```js
scan()
```

fornece os registros como stream/cursor, **não necessariamente array**.

```js
get(id)
```

é a capacidade opcional/primária de lookup.

Mas eu faria uma distinção importante:

### `Table` é interface de execução, não de consulta

A tabela não deveria saber:

```js
where()
pick()
sort()
join()
group()
```

Isso pertence ao álgebra.

A tabela sabe apenas:

```text
"como forneço meus dados?"
```

Enquanto os nodes sabem:

```text
"o que quero fazer com esses dados?"
```

Isso permite uma tabela virtual:

```js
const users = Table({
  schema: {...},
  scan() {
    return fetchUsersFromAPI()
  }
})
```

ou:

```js
const users = Table({
  schema: {...},
  scan() {
    return sqlite.query(...)
  }
})
```

ou:

```js
const users = Table({
  schema: {...},
  scan() {
    return JSON.parse(...)
  }
})
```

ou a própria tabela JSON do IODB.

Todos são equivalentes para o álgebra.

---

## Talvez `Schema` seja a primeira coisa

Eu vejo dois conceitos pequenos:

```js
Schema
Table
```

`Schema` descreve:

```js
{
  name: 'users',
  fields: {
    id:     'string',
    name:   'string',
    age:    'number',
    state:  'string',
    status: 'string'
  }
}
```

`Table` fornece:

```js
{
  schema,
  scan,
  get
}
```

Então:

```js
db.users
```

resolve para um **Table node**, mas a tabela real só é obtida quando necessário.

---

## E o diretório é um catálogo

Isso fica muito limpo:

```js
const db = IO('mydb/')
```

O diretório implementa algo equivalente a:

```js
catalog.get('users')
```

que resolve:

```text
mydb/users.table.json
```

para:

```js
Table
```

Mas o Proxy não precisa carregar a tabela:

```js
db.users
```

produz:

```js
{
  op: 'source',
  table: 'users'
}
```

A resolução:

```text
source('users')
        ↓
catalog.resolve('users')
        ↓
Table
```

fica para `run()`/`optimize()`.

Isso é exatamente a **resolução lazy** que queremos.

---

## Capacidades da Table

Eu evitaria colocar tudo inicialmente na interface.

Podemos evoluir de:

```js
{
  schema,
  scan
}
```

para:

```js
{
  schema,
  scan,
  get,
  find,
  range,
  count
}
```

Mas essas são **capabilities**, não requisitos universais.

Por exemplo:

```js
table.get
```

permite ao optimizer transformar:

```js
users.id(42)
```

em:

```js
lookup(users, 42)
```

Se a tabela não possui `get`, o plano pode cair para:

```text
scan → filter
```

Então o optimizer trabalha com:

```js
table.capabilities
```

ou simplesmente duck typing:

```js
if (table.get) ...
if (table.range) ...
```

Sem transformar `Table` em uma classe gigantesca.

---

# O álgebra fica independente

Podemos então definir os operadores como funções puras:

```js
source(table)

where(input, expr)

pick(input, fields)

sort(input, fields)

limit(input, n)

offset(input, n)

join(left, right, expr)

group(input, fields)

aggregate(input, expr)
```

Todos produzem nodes.

Por exemplo:

```js
where(
  source(users),
  is.gte('age', 18)
)
```

produz apenas:

```js
{
  op: 'where',
  in: {
    op: 'source',
    table: users
  },
  args: [
    {
      op: 'gte',
      args: ['age', 18]
    }
  ]
}
```

Nenhum dado foi acessado.

---

## E isso dá uma fronteira arquitetural muito boa

```text
┌──────────────────────────────┐
│             DX               │
│                              │
│ db.users.age.gte(18)         │
│ db.users.pick(...)           │
│ db.users.where(...)          │
│ db.users(...)                │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│          Query Nodes         │
│                              │
│ source where pick sort ...   │
│ eq gte and or ...            │
└──────────────┬───────────────┘
               │
          optimize()
               │
               ▼
┌──────────────────────────────┐
│        Table Interface       │
│                              │
│ schema                       │
│ scan                         │
│ get                          │
│ range ...                    │
└──────────────┬───────────────┘
               │
               ▼
      JSON / JSONL / CSV /
      memory / HTTP / SQL /
      qualquer Table virtual
```

A consequência é muito boa: **podemos implementar toda a álgebra contra uma Table em memória primeiro**.

Algo mínimo como:

```js
const users = Table({
  schema: {
    id: 'number',
    name: 'string',
    state: 'string'
  },

  scan() {
    return [
      { id: 1, name: 'Alice', state: 'NY' },
      { id: 2, name: 'Bob',   state: 'CA' }
    ]
  }
})
```

E testar:

```js
const db = IO({
  users
})

db.users
  .state('NY')
  .pick('id', 'name')()
```

antes de existir qualquer filesystem.

Depois fazemos:

```js
IO('mydb/')
```

resolver:

```text
users.table.json → Table
```

Ou seja, **Table é o contrato; arquivo é apenas uma implementação de Table.**

Eu acho que esse deve ser o primeiro corte do projeto: `Table/Schema → Nodes → Proxy DX → executor`, com tudo funcionando inicialmente sobre `Table` em memória. Isso nos dá uma prova completa da álgebra sem misturar storage, parser ou filesystem.

## Prompt:
9/11/2026, 1:38:34 AM

{  schema,   scan,   get,   find,   range,   count }
sim eu acho que podemos estabelecer uma api minima para table bem como um schema minimo como

```
  schema: {
    id: 'number @!', // pk not null
    name: 'string !*', // unique not null
    state: 'string ?' optional/nullable
  },
```

estes são só algumas ideias para definir uma dsl simples usando certos caracters marcadores depois do tipo de dados. (O que existe de 'conveção' neste sentido?)

## Response:
9/11/2026, 1:38:42 AM

Sim. E existe bastante convenção, mas **não existe uma única DSL universal** para isso. Há algumas famílias de notação que podemos aproveitar.

Para o seu caso, eu acho que vale a pena separar três conceitos:

```text
tipo        cardinalidade/nullability       constraints
number      obrigatório                      PK
string      obrigatório                      UNIQUE
string      opcional/nullable               ...
```

e compactar isso na string exatamente como você propôs.

### Convenções existentes

Alguns exemplos comuns:

| Sistema/estilo | Exemplo | Significado |
|---|---|---|
| SQL | `name VARCHAR NOT NULL UNIQUE` | obrigatório + único |
| JSON Schema | `type: "string"` + `required: [...]` | tipo e obrigatoriedade separados |
| TypeScript | `name: string`, `state?: string` | `?` = opcional |
| GraphQL | `String!` | `!` = non-null |
| Prisma | `name String @unique` | constraints com `@...` |
| Zod | `z.string().optional()` | métodos explícitos |
| EBNF/gramáticas | marcadores próprios | cardinalidade/sintaxe |

A convenção que mais se aproxima do que você está propondo é provavelmente **GraphQL + Prisma**, mas sua ideia pode ser ainda mais compacta.

---

## Eu gosto de `!`, `?` e `@`

Sua proposta:

```js
schema: {
  id:    'number @!',
  name:  'string !*',
  state: 'string ?'
}
```

é visualmente boa, mas eu faria uma pequena mudança semântica.

### `!` deveria significar `required/non-null`

Assim:

```js
id:    'number !'
name:  'string !'
state: 'string ?'
```

significaria:

```text
!  obrigatório / non-null
?  nullable / optional
```

Mas então precisamos distinguir **optional** de **nullable**, porque em banco eles não são exatamente a mesma coisa.

Por exemplo:

```js
state: 'string?'
```

poderia significar:

```text
valor pode ser null
```

enquanto:

```js
state: 'string'
```

poderia significar:

```text
campo não necessariamente presente
```

Só que isso rapidamente complica.

Para IODB, eu provavelmente adotaria uma semântica mais simples:

```text
tipo       = valor pode existir
!          = required / not-null
?          = nullable
```

e ausência seria simplesmente uma propriedade ausente do POJO.

---

# Constraints com `@`

Aqui sua ideia fica especialmente boa:

```js
id:   'number @!'
name: 'string !*'
```

Mas eu evitaria `@!` se `!` já é um marcador de cardinalidade.

Poderíamos ter:

```js
id:    'number ! @pk'
name:  'string ! @unique'
state: 'string ?'
```

ou compactado:

```js
id:    'number! @pk'
name:  'string! @unique'
state: 'string?'
```

Isso lembra bastante:

```text
type + modifiers + annotations
```

e é uma convenção muito familiar.

---

## Minha preferência

Eu usaria:

```js
const schema = {
  id:    'number! @pk',
  name:  'string! @unique',
  state: 'string?'
}
```

Isso tem uma gramática muito simples:

```text
field := type nullability* annotations*

type  := string | number | boolean | date | json | ...

!     := non-null
?     := nullable

@name := constraint/annotation
```

Então:

```js
{
  id:       'number! @pk',
  email:    'string! @unique',
  name:     'string!',
  state:    'string?',
  age:      'number?',
  metadata: 'json?'
}
```

fica imediatamente legível.

---

# E podemos ter aliases sem aumentar a DSL

Por exemplo:

```js
id: 'number! @pk'
```

implica automaticamente:

```text
@notNull
```

porque PK tradicionalmente não pode ser null.

Então o parser normaliza:

```js
'number! @pk'
```

para algo como:

```js
{
  type: 'number',
  nullable: false,
  pk: true
}
```

Da mesma forma:

```js
'string! @unique'
```

vira:

```js
{
  type: 'string',
  nullable: false,
  unique: true
}
```

O importante é que **a string é apenas sintaxe de entrada**. O schema canônico continua sendo um POJO.

---

# Podemos ir um pouco além

Como o IODB já tem uma filosofia de propriedades tipadas, podemos fazer:

```js
const schema = {
  id:       'number! @pk',
  email:    'string! @unique',
  name:     'string!',
  state:    'string?',
  age:      'number? @index',
  created:  'date! @default:now'
}
```

E posteriormente:

```js
amount: 'number! @min:0'
```

ou:

```js
status: 'string! @enum:active,pending,deleted'
```

Mas **eu não colocaria isso na primeira versão**. Basta reservar `@` para annotations e deixar o parser preparado para argumentos.

---

## Uma coisa que eu mudaria na sua notação original

Você sugeriu:

```js
name: 'string !*'
```

Eu evitaria `*` para `unique`.

`*` possui muitas associações diferentes:

- wildcard
- multiplicidade
- zero ou mais
- pointer/reference
- variadic

Então:

```js
name: 'string! @unique'
```

é um pouco mais comprido, mas muito mais semântico.

Se quisermos uma forma ultra-compacta, podemos definir:

```text
!  required
?  nullable
@x annotation
```

e deixar annotations abreviadas se algum dia houver necessidade:

```js
name: 'string! @u'
```

mas **não começaria com isso**.

---

# O Schema também vira um contrato para Table

Isso fecha muito bem com a interface que você acabou de definir:

```js
const users = {
  schema: {
    id:    'number! @pk',
    name:  'string! @unique',
    state: 'string?'
  },

  scan,
  get,
  find,
  range,
  count
}
```

O executor pode usar `schema` para entender:

```text
id      → PK
name    → UNIQUE
state   → nullable
```

e o optimizer pode descobrir:

```js
users.id(42)
```

→ `get(42)`

enquanto:

```js
users.name('Alice')
```

pode virar:

```js
find('name', 'Alice')
```

se `@unique` estiver presente.

E:

```js
users.age.gte(18)
```

pode usar:

```js
range('age', { gte: 18 })
```

se houver:

```js
age: 'number @index'
```

Ou seja, **schema não é apenas validação**. Ele também fornece as informações necessárias para o planner escolher a capacidade física da `Table`.

Acho que essa é a direção certa: uma DSL de schema minúscula, legível como código, que depois se normaliza para POJO e alimenta tanto **validação quanto otimização**.

## Prompt:
9/11/2026, 11:23:23 AM

considere a seguinte interface no modelo typed properties de soml:

```
 const users = {
  schema: {
    'id number pk autohash|autoinc': 0,
    'name string unique indexed': "",
    'state string null': "",
  },
  scan,
  get,
  find,
  range,
  count
}
```

Vamos pensar nas assinaturas dos métodos para definir uma interface mínima necessária para Table de maneira que uma engine sql possa ser construida sobre ela. Também descrevendo os requisitos ideais que facilitam a construção da engine por paralelismo direto.

## Response:
9/11/2026, 11:23:37 AM

Sim. Com essa forma de schema, eu trataria `Table` como uma **interface física mínima**, deliberadamente mais simples que a álgebra. A engine SQL não deve depender de detalhes de armazenamento; ela só precisa de algumas operações primitivas com semântica forte e previsível.

A questão central é: **quais operações permitem implementar diretamente os operadores relacionais?**

Eu chegaria a algo assim.

## 1. `Table`

```js
const users = {
  schema: {
    'id number pk autohash|autoinc': 0,
    'name string unique indexed': '',
    'state string null': '',
  },

  scan,
  get,
  find,
  range,
  count
}
```

A interface mínima:

```js
Table = {
  schema,
  scan,
  get,
  find,
  range,
  count
}
```

com estas assinaturas conceituais:

```js
table.scan(options?) -> Cursor
table.get(key)       -> Row | null
table.find(query)    -> Cursor
table.range(query)   -> Cursor
table.count(query?)  -> number
```

A palavra importante aqui é **Cursor**.

Não retornaria arrays. A engine SQL precisa poder trabalhar em streaming, paginação e paralelismo sem materialização intermediária.

---

# 2. `schema`

O schema é a descrição declarativa da Table:

```js
schema: {
  'id number pk autohash|autoinc': 0,
  'name string unique indexed': '',
  'state string null': '',
}
```

Eu faria o parser normalizar isso para:

```js
{
  fields: {
    id: {
      type: 'number',
      pk: true,
      autohash: true,
      autoinc: true,
      default: 0
    },

    name: {
      type: 'string',
      unique: true,
      indexed: true,
      default: ''
    },

    state: {
      type: 'string',
      null: true,
      default: ''
    }
  }
}
```

Mas o formato original continua sendo o **source DSL**.

Isso é importante porque a engine consegue descobrir capacidades sem perguntar à Table:

```text
pk       → get
indexed  → find/range
unique   → cardinalidade máxima 1
autohash → geração de chave
autoinc  → geração sequencial
```

---

# 3. `scan`

Esta é a operação fundamental.

```js
table.scan()
```

→ todos os registros.

Mas eu definiria:

```js
table.scan({
  offset?,
  limit?,
  reverse?,
  partition?
})
```

como possibilidade futura, sem exigir tudo inicialmente.

A semântica básica:

```js
scan() -> Cursor<Row>
```

O Cursor precisa ser mínimo:

```js
cursor.next() -> Row | null
```

Talvez:

```js
cursor.next()
cursor.close()
```

e só.

Isso já permite implementar:

```js
SELECT *
FROM users
```

como:

```js
for (let row = cursor.next(); row; row = cursor.next())
  yield row
```

---

# 4. `get`

`get` é lookup por chave primária:

```js
table.get(42)
```

→

```js
{ id: 42, ... }
```

ou:

```js
null
```

Isso é uma operação muito especial porque permite ao optimizer fazer:

```text
WHERE id = 42
```

→

```text
GET 42
```

sem scan.

Eu manteria `get` extremamente restrito:

```js
get(pk) -> Row | null
```

Não:

```js
get({ id: 42, state: 'NY' })
```

porque isso mistura lookup físico com predicado.

---

# 5. `find`

`find` representa lookup por igualdade em índice.

Eu usaria:

```js
table.find(field, value)
```

→ `Cursor<Row>`

Exemplo:

```js
table.find('name', 'Alice')
```

Se `name` for unique:

```text
0 ou 1 row
```

Se for simplesmente indexed:

```text
0..N rows
```

Então:

```js
users.name('Alice')
```

pode eventualmente ser otimizado para:

```js
users.find('name', 'Alice')
```

O contrato poderia ser:

```js
find(field, value) -> Cursor<Row>
```

Isso é deliberadamente simples.

---

# 6. `range`

`range` é a segunda operação física realmente importante.

Algo como:

```js
table.range('age', {
  gte: 18,
  lt: 30
})
```

→ `Cursor<Row>`

ou, de forma ainda mais primitiva:

```js
table.range('age', 18, 30)
```

Mas eu prefiro o objeto porque SQL tem naturalmente:

```text
>
>=
<
<=
BETWEEN
```

Então:

```js
range('age', {
  gte: 18,
  lte: 30
})
```

pode representar diretamente:

```sql
WHERE age BETWEEN 18 AND 30
```

E:

```js
range('created', {
  gte: start
})
```

representa:

```sql
WHERE created >= start
```

---

# 7. `count`

Eu faria:

```js
table.count()
```

→ número de rows.

E opcionalmente:

```js
table.count(query)
```

→ número de rows que satisfazem um lookup físico.

Porém existe uma decisão importante:

### `count()` não precisa ser obrigatório para a álgebra

SQL consegue fazer:

```sql
SELECT COUNT(*) FROM users
```

simplesmente consumindo `scan()`.

Portanto:

```js
count
```

é uma **capability de otimização**, não uma necessidade semântica.

Isso é uma distinção que eu preservaria.

A interface conceitualmente poderia ser:

```js
{
  schema,
  scan,
  get,
  find,
  range,
  count?
}
```

Mas se quisermos um contrato fechado inicial, podemos exigir os seis.

---

# 8. A tabela não implementa SQL

Isso é crucial.

Não queremos:

```js
table.where()
table.sort()
table.group()
table.join()
```

A Table oferece **acesso físico aos dados**.

A álgebra implementa:

```text
Source
Filter
Project
Sort
Limit
Offset
Distinct
Join
Group
Aggregate
Union
...
```

Então:

```js
users
  .state('NY')
  .age.gte(18)
  .pick('name')
```

produz:

```text
Project
  Filter(age >= 18)
    Filter(state = NY)
      Source(users)
```

O optimizer olha para o `Source(users)`, consulta o schema/capabilities e pode transformar:

```text
Filter(state = NY)
  Source(users)
```

em:

```text
Find(users, state, NY)
```

ou:

```text
Range(...)
```

se for apropriado.

---

# 9. Paralelismo direto

Aqui acho que está a parte mais importante da sua pergunta.

Se queremos que a engine seja naturalmente paralelizável, cada primitive deve ter **semântica independente de estado global**.

Idealmente:

```text
scan()   → stream
get()    → independent lookup
find()   → independent stream
range()  → independent stream
count()  → independent reduction
```

Assim:

```text
                Query
                  │
               optimize
                  │
             ┌────┴────┐
             │         │
          partition  partition
             │         │
           scan       scan
             │         │
             └────┬────┘
                  │
                merge
```

é uma transformação natural.

Por exemplo, uma tabela com 10 milhões de registros poderia fornecer:

```js
scan({ partition: 0 })
scan({ partition: 1 })
scan({ partition: 2 })
scan({ partition: 3 })
```

sem a álgebra precisar conhecer se isso significa:

- páginas de arquivo;
- shards;
- blocos;
- CPUs;
- workers;
- arquivos JSONL;
- segmentos de memória.

Isso é exatamente o tipo de abstração que facilita paralelismo.

---

# 10. Cursor precisa ser independente

Eu estabeleceria como requisito:

> **Cada Cursor possui estado próprio e não depende de estado mutável compartilhado da Table.**

Então:

```js
const a = users.scan()
const b = users.scan()
```

pode avançar independentemente:

```js
a.next()
b.next()
a.next()
b.next()
```

Isso parece pequeno, mas é uma propriedade arquitetural enorme.

Permite:

```js
Promise.all([
  scanA(),
  scanB(),
  scanC()
])
```

e workers sem precisar adaptar o executor.

---

# 11. Ordem também deve ser explícita

Outro requisito útil para `range`/`scan`:

```js
Cursor
```

deve ter uma ordem conhecida ou declarada.

Por exemplo:

```js
range('age', { gte: 18, lt: 30 })
```

pode prometer:

```text
ordered by age
```

se a Table possui índice ordenado.

Isso permite ao optimizer implementar:

```sql
ORDER BY age
LIMIT 20
```

sem necessariamente executar um sort global.

Portanto o resultado de uma capability pode carregar metadados:

```js
{
  cursor,
  order: ['age']
}
```

Mas eu **não colocaria isso na primeira interface**. Pode ser uma propriedade opcional do Cursor/plan.

---

# 12. A interface física ideal

Eu resumiria os requisitos assim:

### Obrigatórios

```js
{
  schema,

  scan() -> Cursor,

  get(pk)
    -> Row | null,

  find(field, value)
    -> Cursor,

  range(field, bounds)
    -> Cursor,

  count()
    -> number
}
```

### Requisitos semânticos

```text
scan  → streaming
get   → O(1) quando @pk
find  → index lookup quando @indexed
range → ordered/range lookup quando possível
count → aggregate semântico
```

### Requisitos arquiteturais

```text
• sem estado global de execução
• Cursor independente
• operações reentrantes
• operações composáveis
• nenhuma dependência de SQL
• nenhuma dependência de filesystem
• nenhuma materialização obrigatória
• schema declarativo
• capabilities deriváveis do schema
• partitioning possível
• execução lazy
```

---

# 13. E a tabela virtual fica trivial

Por exemplo, para testar a engine:

```js
const users = {
  schema: {
    'id number pk': 0,
    'name string unique indexed': '',
    'state string null': ''
  },

  scan() {
    return cursor([
      { id: 1, name: 'Alice', state: 'NY' },
      { id: 2, name: 'Bob',   state: 'CA' },
      { id: 3, name: 'Carol', state: 'NY' }
    ])
  },

  get(id) {
    return rows.find(row => row.id === id) ?? null
  },

  find(field, value) {
    return cursor(rows.filter(row => row[field] === value))
  },

  range(field, bounds) {
    return cursor(/* ... */)
  },

  count() {
    return rows.length
  }
}
```

A engine não sabe nem precisa saber que isso está na memória.

Depois:

```js
IO('mydb/')
```

resolve:

```text
mydb/users.table.json
```

para outra implementação do mesmo contrato.

E futuramente podemos ter:

```text
MemoryTable
JsonTable
JsonlTable
CsvTable
SqlTable
HttpTable
ShardTable
```

todas executando **o mesmo Query IR**.

---

## O ponto que eu fixaria como fundamento

A Table deve ser uma **máquina de acesso**, não uma máquina de consulta.

```text
Table
 ├── schema       → o que existe
 ├── scan         → leia tudo
 ├── get          → leia uma chave
 ├── find         → leia por igualdade
 ├── range        → leia por intervalo
 └── count        → conte
```

E isso é quase um espelho direto do que o planner precisa saber:

```text
SOURCE
  ↓
SCAN
GET
FIND
RANGE
COUNT
```

Todo o restante pode ser construído pela álgebra:

```text
WHERE
PROJECT
SORT
LIMIT
OFFSET
DISTINCT
JOIN
GROUP
AGGREGATE
UNION
```

Essa divisão é particularmente boa para a nossa próxima etapa: podemos definir **formalmente os nodes da álgebra e suas assinaturas `Stream → Stream` / `Expr → Value`**, sem ainda escrever o executor. Isso nos dá o IR sobre o qual o Proxy, o parser "burro" e futuramente o SQL parser convergem.

## Prompt:
9/11/2026, 11:35:10 AM

Tenho a impressão que filter & group deveriam ser  operações fundamentais. Note que o find recorreu a ele para ser implementado. Ou é melhor sempre pensar em termos de range e deixar a algebra combinar o mínimo de operadores?

## Response:
9/11/2026, 11:35:17 AM

Sim — eu separaria **álgebra lógica** de **capabilities físicas da Table**. Isso resolve a aparente contradição.

`filter` e `group` são operações fundamentais da álgebra. `find` e `range` são operações de acesso que a Table oferece para o executor/planner.

### 1. `filter` é fundamental

Eu concordo fortemente aqui.

A operação relacional básica é:

```text
filter : Stream<Row> × Expr → Stream<Row>
```

Por exemplo:

```js
filter(
  scan(users),
  is.eq('state', 'NY')
)
```

produz:

```js
{
  op: 'filter',
  in: { op: 'scan', table: 'users' },
  args: [
    { op: 'eq', args: ['state', 'NY'] }
  ]
}
```

Então `find` **não precisa existir na álgebra lógica**.

O optimizer pode transformar:

```text
filter(eq(name, "Alice"))
        │
        ▼
   find(name, "Alice")
```

quando percebe:

```text
schema.name.indexed
```

Ou:

```text
filter(gte(age, 18))
```

→

```text
range(age, {gte: 18})
```

Portanto:

```text
filter
```

é semântico, enquanto:

```text
find
range
get
```

são estratégias físicas.

---

# 2. `range` não deve substituir `filter`

Eu não tentaria reduzir tudo a `range`.

Porque:

```js
filter(row => row.age >= 18 && row.state === 'NY')
```

não é necessariamente uma operação de range.

A álgebra deve dizer **o que** queremos:

```text
filter(predicate)
```

e o planner decide:

```text
scan + filter
```

ou:

```text
range(age, >=18) + filter(state=NY)
```

ou:

```text
find(state, NY) + filter(age>=18)
```

ou até:

```text
index intersection
```

Isso é exatamente a separação que queremos.

---

# 3. `group` também é fundamental

Aqui eu faria uma distinção interessante.

`group` não é apenas uma otimização de `filter`; ele muda a natureza do stream:

```text
group : Stream<Row> × KeyExpr → Stream<Group>
```

Por exemplo:

```js
users.group('state')
```

conceitualmente:

```js
{
  op: 'group',
  in: source(users),
  args: ['state']
}
```

Produz grupos:

```text
NY → [Alice, Carol]
CA → [Bob]
```

Depois agregações operam sobre esses grupos:

```js
users
  .group('state')
  .count()
```

→

```text
NY  2
CA  1
```

Então eu colocaria `group` no núcleo da álgebra.

---

# 4. O núcleo mínimo começa a ficar muito claro

Eu reduziria a álgebra para algo como:

```text
SOURCE
FILTER
PROJECT
GROUP
SORT
LIMIT
```

e talvez:

```text
JOIN
UNION
```

como operadores estruturais.

Depois:

```text
COUNT
SUM
AVG
MIN
MAX
```

como agregações.

Isso é muito mais importante que ter dezenas de operadores.

---

# 5. Table fica com outra responsabilidade

Então temos duas listas diferentes.

### Logical algebra

```text
source
filter
project
group
sort
limit
offset
join
union
aggregate
```

### Table capabilities

```text
scan
get
find
range
count
```

A relação entre elas é:

```text
             logical plan
                  │
             optimize()
                  │
          ┌───────┴───────┐
          │               │
       filter           source
                          │
                  schema/capabilities
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
             get         find        range
```

Ou seja, **`find` e `range` não são concorrentes de `filter`; são possíveis implementações de `filter`.**

---

# 6. Isso deixa `find` particularmente elegante

Imagine:

```js
db.users.name('Alice')
```

Semanticamente:

```text
FILTER(users, name = 'Alice')
```

O optimizer consulta:

```text
schema.name → unique indexed
```

e reescreve:

```text
FILTER(name = Alice)
```

para:

```text
GET/LOOKUP(name, Alice)
```

Se não existe índice:

```text
SCAN → FILTER
```

Se existe índice:

```text
FIND
```

Se é intervalo:

```text
RANGE
```

A DX nunca precisa saber disso.

---

# 7. Eu faria `find` e `range` capabilities, não necessariamente métodos públicos da Table

Há uma questão interessante aqui.

Você propôs:

```js
{
  schema,
  scan,
  get,
  find,
  range,
  count
}
```

Eu manteria essa API porque é excelente como **interface física mínima**.

Mas conceitualmente:

```text
scan/get/find/range/count
```

não são todos equivalentes.

Eu classificaria:

```text
scan       fundamental access
get        key capability
find       equality-index capability
range      ordered-index capability
count      aggregate capability
```

Assim podemos ter uma Table virtual mínima que só possui:

```js
{
  schema,
  scan
}
```

e ainda executar **toda a álgebra**.

Ela apenas será menos otimizada.

Isso é uma propriedade muito boa:

```text
Table = schema + scan
```

é suficiente para correção.

As demais operações são aceleradores.

---

# 8. E isso resolve o problema do paralelismo

Com apenas:

```text
scan
```

podemos sempre executar:

```text
FILTER
PROJECT
GROUP
SORT
```

em software.

Quando a Table oferece capabilities:

```text
find
range
```

o planner pode empurrar trabalho para baixo.

Então temos uma espécie de hierarquia:

```text
          CORRETO
             │
           scan
             │
      ┌──────┴──────┐
      │             │
    find          range
      │             │
   index          index
```

E para paralelismo:

```text
scan
 │
 ├── partition 0 → filter
 ├── partition 1 → filter
 ├── partition 2 → filter
 └── partition 3 → filter
                    │
                  merge
                    │
                  group
```

Depois podemos paralelizar `group` com uma operação de **local aggregate + merge**, sem mudar a semântica.

---

## Minha escolha

Eu fixaria:

```js
// Logical algebra
source
filter
project
group
sort
limit
offset
join
union
aggregate
```

e:

```js
// Physical Table interface
{
  schema,
  scan,
  get,
  find,
  range,
  count
}
```

Com a regra:

> **A álgebra descreve a intenção. A Table descreve as capacidades. O optimizer faz a ponte.**

E particularmente:

```text
filter ≠ find ≠ range
```

mas:

```text
find/range ⊂ possíveis implementações eficientes de filter
```

Isso nos dá uma álgebra pequena sem sacrificar o acesso eficiente do IODB. E `group` merece estar no núcleo porque, ao contrário de `find`/`range`, ele é uma transformação semântica da relação, não apenas uma estratégia de acesso.

## Prompt:
9/11/2026, 11:44:49 AM

OK. Vamos escrever MIN-TABLE-INTF.md descrevendo a interface minima e ideal fundamental de Table para implementação de uma algebra relacional puramente funcional (como discutimos antes) sobre ela. Ela deve descrever uma escalada de funcionalidades partindo de {schema, scan} mas com outros metodos como {   schema,   scan,   get,   find,   range,   count, filter, group, ...}

## Response:
9/11/2026, 11:44:57 AM

Sim. Eu estruturaria o documento deixando muito clara a **escada de capacidades**: uma `Table` com apenas `{schema, scan}` já é suficiente para executar a álgebra inteira; os demais métodos são capacidades progressivamente mais fortes que permitem ao planner evitar scans, reduzir materialização e explorar paralelismo.

**document: **

# MIN-TABLE-INTF

Minimal and ideal interface for a Table implementation supporting a purely functional relational algebra.

## 1. Purpose

`Table` is the minimal physical data interface over which a relational algebra can be built.

The algebra describes **what** should happen:

```text
source
filter
project
group
sort
limit
offset
join
union
aggregate
```

`Table` describes **how data can be obtained efficiently**:

```text
schema
scan
get
find
range
count
filter
group
...
```

The two layers must remain independent.

A `Table` does not need to understand SQL.

A query does not need to know whether the table is backed by:

- memory
- JSON
- JSONL
- CSV
- an index
- another database
- HTTP
- a remote shard
- a generated/virtual source

The same relational nodes must operate over all of them.

The fundamental principle is:

```text
             logical algebra
                    |
                 optimize
                    |
             physical access
                    |
                  Table
```

---

# 2. Minimal Table

The absolute minimum implementation is:

```js
const table = {
  schema,
  scan
}
```

This is sufficient for correctness.

Everything else can be implemented by the algebra on top of `scan()`.

For example:

```text
find(field, value)
    =
scan()
  + filter(eq(field, value))
```

and:

```text
range(field, bounds)
    =
scan()
  + filter(range-expression)
```

and:

```text
count()
    =
scan()
  + count
```

Therefore:

> `{ schema, scan }` is the minimum complete Table interface.

The additional methods are capabilities, not semantic requirements.

---

# 3. Schema

The schema is declarative metadata describing the rows and their constraints.

Example:

```js
const users = {
  schema: {
    'id number pk autohash|autoinc': 0,
    'name string unique indexed': '',
    'state string null': '',
  },

  scan,
  get,
  find,
  range,
  count
}
```

The schema DSL follows the SOML typed-property model:

```text
'name type modifiers': default
```

Examples:

```js
{
  'id number pk autohash|autoinc': 0,
  'name string unique indexed': '',
  'state string null': '',
  'age number indexed': 0
}
```

The schema should be normalized internally to a POJO.

Conceptually:

```js
{
  fields: {
    id: {
      type: 'number',
      pk: true,
      autohash: true,
      autoinc: true,
      default: 0
    },

    name: {
      type: 'string',
      unique: true,
      indexed: true,
      default: ''
    },

    state: {
      type: 'string',
      nullable: true,
      default: ''
    }
  }
}
```

The schema has two roles:

1. describe and validate data;
2. describe physical capabilities available to the optimizer.

For example:

```text
pk       → get()
indexed  → find() / range()
unique   → at most one result
```

---

# 4. `scan`

The fundamental access operation:

```js
table.scan()
```

returns a cursor/stream of rows.

Conceptually:

```js
scan() -> Cursor<Row>
```

The Table must not require the caller to materialize all rows.

A minimal cursor is:

```js
const cursor = table.scan()

cursor.next() // Row | null
```

Optionally:

```js
cursor.close()
```

The important semantic property is:

> Each cursor has independent execution state.

Thus:

```js
const a = table.scan()
const b = table.scan()

a.next()
b.next()
a.next()
```

must be valid and independent.

This property is important for parallel execution, nested operators and concurrent queries.

---

# 5. Correctness baseline

A Table implementing only:

```js
{
  schema,
  scan
}
```

must still support the complete logical algebra.

For example:

```text
SOURCE
  ↓
FILTER
  ↓
PROJECT
  ↓
SORT
  ↓
LIMIT
```

can always be executed by consuming the scan.

This establishes an important rule:

> Optimization must never be required for correctness.

A capability merely provides a better implementation.

---

# 6. `get`

Primary-key lookup:

```js
table.get(key)
```

returns:

```text
Row | null
```

Example:

```js
table.get(42)
```

The semantic equivalent is:

```text
scan()
  |> filter(id == 42)
  |> first
```

but a Table with a primary-key implementation should provide direct lookup.

The optimizer can transform:

```text
FILTER(eq(pk, 42))
    SOURCE(table)
```

into:

```text
GET(table, 42)
```

Schema:

```js
'id number pk': 0
```

therefore establishes the relationship:

```text
pk → get
```

`get` is an access capability, not a relational operator.

---

# 7. `find`

Equality lookup:

```js
table.find(field, value)
```

returns:

```text
Cursor<Row>
```

Example:

```js
table.find('name', 'Alice')
```

Semantically:

```text
scan()
  |> filter(name == 'Alice')
```

but can use an index when:

```js
'name string indexed'
```

is present.

For:

```js
'name string unique indexed'
```

the result is known to contain at most one row.

The optimizer can therefore transform:

```text
FILTER(eq(name, "Alice"))
    SOURCE(users)
```

into:

```text
FIND(users, name, "Alice")
```

or, when appropriate:

```text
GET(...)
```

---

# 8. `range`

Range lookup:

```js
table.range(field, bounds)
```

returns:

```text
Cursor<Row>
```

Example:

```js
table.range('age', {
  gte: 18,
  lt: 30
})
```

Possible bounds:

```js
{
  gt,
  gte,
  lt,
  lte
}
```

This corresponds naturally to:

```sql
WHERE age >= 18 AND age < 30
```

A range capability is particularly valuable for:

- numeric fields
- dates
- ordered strings
- timestamps
- ordered indexes

The logical algebra remains:

```text
FILTER(predicate)
```

The optimizer may replace it with:

```text
RANGE(field, bounds)
```

when the Table can execute that predicate efficiently.

---

# 9. `count`

Basic count:

```js
table.count()
```

returns:

```text
number
```

A minimal implementation can always be:

```text
scan()
  |> count
```

But a physical Table may implement it directly.

For example, if row count is already known:

```js
count() -> O(1)
```

For a filtered count, an optional form may be supported:

```js
table.count(predicate)
```

However, filtered count is not fundamental to the Table interface.

It is sufficient for the algebra to implement:

```text
FILTER
  ↓
COUNT
```

and let optimization discover a faster Table-specific operation.

Therefore:

```text
count
```

is primarily an optimization capability.

---

# 10. `filter`

`filter` is fundamentally different from `find` and `range`.

`filter` belongs to the **logical relational algebra**:

```text
filter(Stream<Row>, Expr)
    -> Stream<Row>
```

Conceptually:

```js
filter(input, is.eq('state', 'NY'))
```

produces:

```js
{
  op: 'filter',
  in: input,
  args: [
    {
      op: 'eq',
      args: ['state', 'NY']
    }
  ]
}
```

A Table does not need `filter`.

A physical implementation may optionally provide:

```js
table.filter(predicate)
```

when it can execute predicates internally more efficiently.

But this should be viewed as a capability.

The distinction is:

```text
filter = semantic operation
find   = equality access strategy
range  = range access strategy
```

Thus:

```text
filter(eq(name, 'Alice'))
```

may become:

```text
find(name, 'Alice')
```

while:

```text
filter(gte(age, 18))
```

may become:

```text
range(age, { gte: 18 })
```

or remain:

```text
scan + filter
```

---

# 11. `group`

`group` is also a fundamental logical operation.

Unlike `find` and `range`, it changes the structure of the stream.

```text
group(Stream<Row>, KeyExpr)
    -> Stream<Group>
```

Example:

```js
group(users, 'state')
```

conceptually produces:

```text
NY → [...]
CA → [...]
SP → [...]
```

It is therefore part of the algebra:

```text
SOURCE
  ↓
FILTER
  ↓
GROUP
  ↓
AGGREGATE
```

Example:

```js
db.orders
  .group('customerId')
  .count()
```

corresponds to:

```sql
SELECT customerId, COUNT(*)
FROM orders
GROUP BY customerId
```

A Table may optionally provide:

```js
table.group(...)
```

but it is not required for correctness.

The generic algebra can always implement grouping from `scan()`.

---

# 12. Capability levels

A useful progression is:

## Level 0 — complete functional Table

```js
{
  schema,
  scan
}
```

Capabilities:

```text
scan
filter
project
sort
group
aggregate
join
union
limit
offset
```

Everything is implemented by consuming the stream.

This is the reference implementation.

---

## Level 1 — primary-key access

```js
{
  schema,
  scan,
  get
}
```

Adds efficient:

```text
pk = value
```

queries.

---

## Level 2 — equality indexes

```js
{
  schema,
  scan,
  get,
  find
}
```

Adds efficient:

```text
field = value
```

queries.

Schema:

```js
'name string indexed'
```

---

## Level 3 — ordered indexes

```js
{
  schema,
  scan,
  get,
  find,
  range
}
```

Adds efficient:

```text
field > value
field >= value
field < value
field <= value
BETWEEN
ORDER BY field
```

when the physical implementation provides ordered access.

---

## Level 4 — aggregate capabilities

```js
{
  schema,
  scan,
  get,
  find,
  range,
  count
}
```

Allows direct cardinality operations.

---

## Level 5 — pushed relational operations

Optional physical capabilities:

```js
{
  schema,
  scan,
  get,
  find,
  range,
  count,

  filter,
  group,
  ...
}
```

These allow the Table to execute portions of the logical plan itself.

They are useful when the underlying storage can perform the operation more efficiently than the generic executor.

---

# 13. Logical vs physical operations

The conceptual division should remain:

```text
LOGICAL ALGEBRA

source
filter
project
group
aggregate
sort
limit
offset
join
union
```

versus:

```text
TABLE CAPABILITIES

scan
get
find
range
count
filter?
group?
...
```

The question mark matters.

The logical operation is mandatory.

The physical implementation is optional.

For example:

```text
FILTER(state = 'NY')
        │
        ▼
     optimize
        │
        ├── find(state, 'NY')
        │
        └── scan + filter
```

Both have identical semantics.

---

# 14. Functional requirements

The Table interface should ideally satisfy these properties.

## Purity of observation

Read operations should not mutate the Table:

```js
scan()
get()
find()
range()
count()
```

Repeated calls must describe independent reads.

## Reentrancy

Multiple cursors must coexist:

```js
const a = table.scan()
const b = table.scan()
```

without shared cursor state.

## Laziness

`scan`, `find` and `range` should preferably return streams/cursors rather than arrays.

## Composability

A cursor should be consumable by generic algebra operators:

```text
Table
  ↓
Cursor
  ↓
Filter
  ↓
Project
  ↓
Group
```

## Deterministic semantics

The same Table state and operation must produce the same logical result.

## Explicit ordering

Unless explicitly guaranteed by the Table, consumers must not assume scan order.

An index-backed `range` may optionally expose ordering metadata.

---

# 15. Parallelism

The interface should be designed so that parallel execution is possible without changing the algebra.

The most important requirement is independent cursors.

Conceptually:

```text
                 scan
                  |
        +---------+---------+
        |         |         |
    partition  partition  partition
        |         |         |
      filter    filter    filter
        |         |         |
        +---------+---------+
                  |
                merge
```

A future Table may support:

```js
scan({ partition })
```

or expose partitions separately.

This should be an extension rather than a requirement of the minimal interface.

The same principle applies to indexes:

```text
find(...)
range(...)
```

should be independently executable.

---

# 16. Parallel group and aggregate

`group` should ideally support the functional decomposition:

```text
partition
   ↓
local group/aggregate
   ↓
merge
```

For example:

```text
GROUP BY state, COUNT(*)
```

can become:

```text
worker 1 → NY: 120
worker 2 → NY:  80
worker 3 → NY: 100

merge → NY: 300
```

This is one reason to keep the relational algebra functional.

Operators should preferably have well-defined composition and reduction semantics rather than depend on mutable global state.

---

# 17. Table as a virtual interface

A Table does not imply a particular storage format.

A memory Table:

```js
const table = {
  schema,
  scan() {
    return cursor(rows)
  }
}
```

A JSON Table:

```js
const table = {
  schema,
  scan() {
    return jsonCursor(file)
  }
}
```

A remote Table:

```js
const table = {
  schema,
  scan() {
    return remoteCursor(url)
  }
}
```

All three are valid sources for the same algebra.

This is a central design goal.

---

# 18. IODB directory

The IODB namespace resolves Tables lazily.

```js
const db = IO('mydb/')
```

Then:

```js
db.users
```

represents:

```text
mydb/users.table.json
```

but does not need to materialize the file immediately.

The Proxy produces a source node:

```js
{
  op: 'source',
  name: 'users'
}
```

Execution eventually resolves:

```text
source('users')
      ↓
IO catalog
      ↓
Table
      ↓
scan/get/find/range/...
```

Therefore the query layer remains independent of the filesystem.

---

# 19. Relational algebra over Table

The complete conceptual pipeline is:

```text
                 DX / SQL / API
                       |
                       ▼
                  Query Nodes
                       |
                       ▼
                    optimize
                       |
                       ▼
                 Physical Plan
                       |
                       ▼
                     Table
                       |
                       ▼
                    Cursor
                       |
                       ▼
                 result/page
```

Example:

```js
db.users
  .status('active')
  .age.gte(18)
  .pick('id', 'name')
  .sort('name')
  .limit(20)()
```

Initially:

```text
LIMIT
  SORT
    PROJECT
      FILTER(age >= 18)
        FILTER(status = active)
          SOURCE(users)
```

After optimization, if indexes exist:

```text
LIMIT
  SORT
    PROJECT
      FILTER(age >= 18)
        FIND(users, status, active)
```

Or another physical plan if that is cheaper.

The logical query does not change.

---

# 20. Recommended canonical interface

The recommended complete baseline interface is:

```js
const Table = {
  schema,

  // fundamental access
  scan,

  // key/index access
  get,
  find,
  range,

  // aggregate capability
  count,

  // optional pushed operations
  filter,
  group,
}
```

The minimal contract is:

```js
{
  schema,
  scan
}
```

The practical IODB contract is:

```js
{
  schema,
  scan,
  get,
  find,
  range,
  count
}
```

and future implementations may additionally expose:

```js
{
  filter,
  group,
  sort,
  project,
  aggregate,
  join,
  ...
}
```

only when the underlying storage can execute them beneficially.

---

# 21. Fundamental principle

The architecture should preserve this distinction:

```text
               SEMANTICS
                  │
          relational algebra
                  │
      ┌───────────┴───────────┐
      │                       │
   filter                  group
   project                 aggregate
   sort                    join
   limit                   union
      │                       │
      └───────────┬───────────┘
                  │
               optimizer
                  │
                  ▼
              CAPABILITIES
                  │
              Table
                  │
       ┌──────────┼──────────┐
       │          │          │
      scan        get       find
                             │
                           range
                             │
                           count
```

**`{schema, scan}` defines what a Table is capable of semantically.**

**`get`, `find`, `range`, `count` make it efficient.**

**`filter`, `group`, and other pushed operations are optional physical accelerators.**

This allows the relational engine to remain purely functional while the Table implementation remains a small, replaceable, virtual data source.

## Prompt:
9/11/2026, 11:58:47 AM

ótimo agora baseado nessa tabela (considerando ideal), no sentido que ela prepara e facilita o caminho oferecendo a infra completa, de forma que a algebra completa e facilmente otimizavel sobre graphos de nodes e bitmaps possa ser facilmente implementada. (Sempre distribuindo a carga para quem sabe fazer melhor e tem todos os recursos para)

## Response:
9/11/2026, 11:58:50 AM

Exatamente. Eu trataria a tabela anterior não apenas como uma **interface mínima**, mas como a **infraestrutura ideal de execução** sobre a qual a álgebra relacional pode crescer sem precisar reinventar a camada física.

A ideia central fica ainda mais clara assim:

> **A Table não implementa a álgebra. Ela oferece os recursos para que a álgebra possa delegar cada operação ao mecanismo que sabe executá-la melhor.**

### 1. A Table ideal

Eu consolidaria a interface em:

```js
const table = {
  schema,

  scan,
  get,
  find,
  range,
  count,

  // capacidades opcionais
  filter,
  project,
  sort,
  group,
  aggregate,
  join,
}
```

Mas há uma distinção importante:

```text
                    RELATIONAL ALGEBRA
                           │
             ┌─────────────┴─────────────┐
             │                           │
          logical                    optimizer
             │                           │
             └─────────────┬─────────────┘
                           │
                         PLAN
                           │
                    capability dispatch
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
           scan          find          range
             │             │             │
             └─────────────┼─────────────┘
                           ▼
                         Table
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
             RAM          IODB        SQLite
```

Ou seja, **a álgebra descreve o que quer; a Table sabe o que consegue fazer eficientemente**.

---

# 2. Isso permite uma álgebra extremamente simples

A álgebra pode ser praticamente um conjunto de transformações puras:

```js
source(table)

filter(expr, input)

project(fields, input)

sort(order, input)

limit(n, input)

offset(n, input)

distinct(fields, input)

group(keys, input)

aggregate(spec, input)

join(left, right, expr)

union(left, right)
```

Todas produzem apenas nodes:

```js
{
  op: 'filter',
  args: [expr],
  in: ...
}
```

Nada disso precisa saber se existe:

- índice B-tree
- hash index
- bitmap
- cache
- mmap
- SQLite
- IODB
- memória
- filesystem
- servidor remoto
- GPU

Essa ignorância é justamente uma vantagem.

---

# 3. O optimizer vira um compilador de grafos

Por exemplo:

```js
db.users
  .status('active')
  .age.gte(18)
  .pick('id', 'name')
  .limit(20)
```

pode inicialmente virar:

```text
LIMIT 20
  PROJECT id,name
    FILTER age >= 18
      FILTER status = active
        SOURCE users
```

O optimizer transforma isso.

### Sem índices

```text
SCAN users
  → FILTER status
  → FILTER age
  → PROJECT
  → LIMIT
```

### Com índice de status

```text
FIND users.status = active
  → FILTER age >= 18
  → PROJECT
  → LIMIT
```

### Com índice ordenado de age

```text
FIND users.status = active
  → RANGE age >= 18
  → PROJECT
  → LIMIT
```

### Com bitmap

Pode simplesmente virar algo conceitualmente como:

```text
BITMAP(status = active)
AND
BITMAP(age >= 18)
→ MATERIALIZE ROWS
→ PROJECT
→ LIMIT
```

A álgebra **não mudou absolutamente nada**.

---

# 4. Bitmap passa a ser uma estratégia física

Isso é particularmente interessante para o que você está propondo.

O bitmap não precisa contaminar a álgebra.

Podemos ter:

```text
FILTER
  EQ(status, active)
```

e o planner descobrir:

```text
status = active
        ↓
bitmap index
        ↓
Bitmap { ... }
```

Depois:

```text
FILTER(age >= 18)
```

pode produzir outro conjunto:

```text
Bitmap { ... }
```

e a execução fazer:

```text
A AND B
```

Ou:

```text
A OR B
```

Ou ainda:

```text
A AND NOT B
```

Isso torna a álgebra booleana extremamente barata quando a infraestrutura oferece bitmap.

---

# 5. E o mais importante: os recursos podem ser combinados

Não precisamos decidir:

> "Tabela usa bitmap"

ou

> "Tabela usa índice"

ou

> "Tabela faz scan".

Uma Table pode oferecer vários caminhos simultaneamente:

```js
{
  schema,

  scan,
  get,
  find,
  range,
  count,

  bitmap,
  ...
}
```

Então:

```text
                    FILTER
                       │
                 optimizer
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
        get()       find()       range()
                       │
                       ▼
                    bitmap
                       │
                       ▼
                     scan
```

O planner escolhe.

---

# 6. Isso leva naturalmente a "capabilities"

Eu evitaria criar uma enorme interface obrigatória.

A Table ideal continua sendo duck typed.

```js
{
  schema,
  scan,
  get,
  find,
  range,
  count
}
```

é uma Table completa o suficiente para o planner.

Mas uma implementação pode oferecer:

```js
{
  schema,
  scan,
  get,
  find,
  range,
  count,

  bitmap,
  sort,
  group,
  aggregate,
  join
}
```

Outra:

```js
{
  schema,
  scan,
  get,
  find,
  range
}
```

Outra:

```js
{
  schema,
  scan
}
```

**Todas executam a mesma álgebra.**

A diferença é apenas o quanto conseguem fazer "perto dos dados".

---

# 7. "Distribuir a carga para quem sabe fazer melhor"

Esse é, na minha opinião, o princípio arquitetural mais importante aqui.

Por exemplo:

### Storage

Sabe:

```text
scan
get
find
range
```

### Bitmap index

Sabe:

```text
eq
in
and
or
not
range
```

### Sort engine

Sabe:

```text
sort
```

### Aggregator

Sabe:

```text
count
sum
avg
min
max
group
```

### Remote DB

Talvez saiba:

```text
filter
project
join
sort
group
aggregate
```

### Planner

Sabe:

```text
quem deve fazer cada coisa
```

A álgebra simplesmente diz:

```text
"quero isso"
```

e o planner pergunta:

```text
"quem sabe fazer isso melhor?"
```

---

# 8. E podemos ir além: nodes como grafo

Não precisamos ficar presos a uma árvore.

Inicialmente:

```text
LIMIT
  PROJECT
    FILTER
      SOURCE
```

é suficiente.

Mas quando houver compartilhamento:

```text
          SOURCE users
             │
          FILTER
             │
       ┌─────┴─────┐
       ▼           ▼
    PROJECT      GROUP
       │           │
       ▼           ▼
    query A      query B
```

temos um **DAG de execução**.

Isso permite:

- compartilhar scans;
- compartilhar bitmaps;
- cachear subexpressões;
- memoização;
- materialização seletiva;
- execução paralela;
- common-subexpression elimination.

E nada disso precisa mudar a API pública.

---

# 9. A fronteira fica muito limpa

Eu desenharia a arquitetura em quatro níveis:

```text
┌──────────────────────────────────────┐
│             USER API                 │
│                                      │
│ JS fluent / SQL / SOML / REST / ... │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│             QUERY IR                  │
│                                      │
│ source/filter/project/group/join/... │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│              PLANNER                 │
│                                      │
│ normalize                           │
│ rewrite                              │
│ optimize                             │
│ capability selection                 │
│ graph scheduling                     │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│           TABLE / CAPABILITIES       │
│                                      │
│ scan get find range count bitmap ... │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│             STORAGE                  │
│                                      │
│ IODB / JSON / memory / SQLite / ... │
└──────────────────────────────────────┘
```

Essa separação é muito poderosa porque **cada camada fica pequena**.

---

## 10. E isso combina perfeitamente com IODB

No seu caso, eu faria a Table de IODB ser inicialmente algo próximo de:

```js
const users = {
  schema,

  scan() {
    ...
  },

  get(id) {
    ...
  },

  find(field, value) {
    ...
  },

  range(field, bounds) {
    ...
  },

  count() {
    ...
  }
}
```

Depois podemos adicionar infraestrutura especializada:

```js
users.bitmap(...)
users.sort(...)
users.aggregate(...)
```

sem alterar a álgebra.

E a consequência mais interessante é:

> **IODB não precisa virar um banco SQL.**

Ele só precisa ser uma excelente **fonte física de dados e capacidades de acesso**.

O query engine fica acima dele.

---

## 11. Eu fecharia o princípio da Table assim

> **Table é uma fronteira de capacidades, não uma implementação da álgebra.**
>
> A álgebra define operações semânticas universais.
> O planner transforma e combina essas operações.
> A Table expõe as capacidades físicas disponíveis.
> O storage executa essas capacidades da maneira mais eficiente que conhece.
>
> Quanto mais capacidades uma Table oferece, mais agress

## Prompt:
9/11/2026, 3:01:28 PM

continue. finalizando o documento anterior e preparando o pseudocódigo e modelo de dados / contratos para a implementação da engine. Deve ser uma spec detalhada que um modelo mais simples possa implementar.

## Response:
9/11/2026, 3:01:38 PM

Sim. Eu fecharia o `MIN-TABLE-INTF.md` como uma **spec de fundação da engine**, indo além da descrição da interface e deixando definidos: modelo de dados, contratos, IR, cursor, capabilities, planner, executor, bitmap, pseudocódigo e ordem de implementação.

A regra para um modelo mais simples implementar deve ser: **cada componente tem uma responsabilidade pequena, entradas/saídas explícitas e nenhuma dependência implícita de outro componente**.

**document: **

# MIN-TABLE-INTF.md

## Table Interface and Relational Engine Foundation

> **Status:** specification
> **Purpose:** foundation for a functional relational algebra and optimizer
> **Implementation target:** simple, portable JavaScript/Bun implementation
> **Design principle:** semantic operations are universal; physical execution is delegated to the component that can perform it best.

---

# 1. Purpose

`Table` is the fundamental physical interface between a relational algebra engine and a data source.

It is intentionally **not** a SQL interface and does not implement relational algebra itself.

The architecture separates:

```text
API
  ↓
Query IR
  ↓
Relational Algebra
  ↓
Planner / Optimizer
  ↓
Table Capabilities
  ↓
Storage
```

The relational algebra describes **what** must be computed.

The Table describes **what the underlying data source can do efficiently**.

The planner decides **where and how each operation should execute**.

This permits the same algebra to operate over:

- memory
- IODB
- JSON
- JSONL
- CSV
- SQLite
- remote databases
- HTTP APIs
- generated data
- partitioned data
- indexed data
- bitmap indexes
- future storage engines

without changing the logical query language.

---

# 2. Fundamental Principle

The most important rule is:

> **Never put an optimization into the algebra when it is really a physical capability.**

For example:

```text
filter(age >= 18)
```

is a logical operation.

Whether it is executed using:

```text
SCAN + FILTER
```

or:

```text
RANGE(age, >=18)
```

or:

```text
BITMAP(age >= 18)
```

is a physical decision.

Therefore:

```text
FILTER
```

belongs to the algebra.

```text
RANGE
BITMAP
FIND
```

are execution capabilities.

---

# 3. Minimal Table Contract

The complete relational algebra must be executable using only:

```js
{
  schema,
  scan
}
```

That is the **correctness baseline**.

Everything else is an optimization capability.

Minimal example:

```js
const table = {
  schema: {
    'id number pk': 0,
    'name string': '',
  },

  scan() {
    // return Cursor<Row>
  }
}
```

A complete relational engine must be able to evaluate every relational operation by falling back to:

```text
scan → transform → scan
```

This guarantees that optimizations never become semantic requirements.

---

# 4. Ideal Table Contract

An ideal Table exposes:

```js
{
  schema,

  scan,
  get,
  find,
  range,
  count,

  // optional physical capabilities
  filter,
  project,
  sort,
  group,
  aggregate,
  join,
  bitmap,
}
```

The first six form the recommended physical foundation:

```js
{
  schema,
  scan,
  get,
  find,
  range,
  count
}
```

The remaining operations are optional acceleration capabilities.

A Table does not need to implement every capability.

---

# 5. Table Is a Duck-Typed Object

No Table class is required.

A Table is identified by its behavior.

```js
function isTable(x) {
  return x
    && x.schema
    && typeof x.scan === 'function'
}
```

Do not require inheritance.

Do not require a framework.

Do not require a specific storage implementation.

A simple POJO is sufficient.

---

# 6. Schema

`schema` describes fields and their physical/logical properties.

Example:

```js
const schema = {
  'id number pk autohash|autoinc': 0,
  'name string unique indexed': '',
  'state string null': '',
}
```

The schema DSL is SOML-style:

```text
field := name type modifier*
```

Example:

```text
id number pk autoinc
name string unique indexed
state string null
```

The parser normalizes this into an internal representation.

Example:

```js
{
  fields: {
    id: {
      type: 'number',
      pk: true,
      autoinc: true,
      default: 0
    },

    name: {
      type: 'string',
      unique: true,
      indexed: true,
      default: ''
    },

    state: {
      type: 'string',
      nullable: true,
      default: ''
    }
  }
}
```

The exact internal representation is not part of the public Table contract.

The semantic properties are.

---

# 7. Schema Properties

The following properties are relevant to planning.

| Property | Meaning |
|---|---|
| `pk` | field is part of primary key |
| `unique` | value identifies at most one row |
| `indexed` | equality/range lookup may be accelerated |
| `null` | field may contain null |
| `autoinc` | storage can generate increasing values |
| `autohash` | storage can generate deterministic hash identifiers |
| `type` | logical field type |

The optimizer may use this metadata.

Example:

```text
WHERE id = 42
```

with:

```text
id pk
```

can become:

```text
GET(42)
```

---

# 8. Row

A Row is a plain object.

Example:

```js
{
  id: 42,
  name: 'Alice',
  state: 'NY'
}
```

Rows must not contain engine metadata.

Internal metadata belongs outside the row.

Do not modify rows merely to execute a query.

---

# 9. Cursor

`scan()` must return a Cursor.

A Cursor represents a lazy stream of rows.

Minimal contract:

```js
const cursor = table.scan()

cursor.next()
cursor.next()
cursor.next()
```

`next()` returns:

```text
Row
```

or:

```text
null
```

when exhausted.

Optional:

```js
cursor.close()
```

Recommended complete contract:

```js
{
  next,
  close
}
```

No array is required.

---

# 10. Cursor Requirements

Every call to `scan()` creates independent execution state.

This must work:

```js
const a = table.scan()
const b = table.scan()

a.next()
b.next()
a.next()
b.next()
```

The two cursors must not interfere.

Avoid:

```js
table._cursor
```

or any global mutable scan state.

Prefer:

```js
function scan() {
  let position = 0

  return {
    next() {
      // use local position
    }
  }
}
```

This naturally supports:

- nested queries
- concurrent queries
- parallel execution
- multiple consumers
- pagination

---

# 11. Ordering

`scan()` must not imply ordering unless the Table explicitly guarantees it.

The logical algebra must assume:

```text
unordered relation
```

unless an explicit:

```text
sort
```

operation exists.

A physical index may naturally return ordered rows, but this must not automatically become a semantic guarantee.

The optimizer may exploit physical ordering only when it knows the ordering guarantee.

---

# 12. `get`

Signature:

```js
get(key) -> Row | null
```

`get` performs primary-key lookup.

Example:

```js
table.get(42)
```

For composite keys:

```js
table.get([42, 7])
```

if supported by the schema.

Semantics:

```text
zero rows → null
one row  → Row
```

A primary key must identify at most one row.

---

# 13. `find`

Signature:

```js
find(field, value) -> Cursor
```

Example:

```js
table.find('state', 'NY')
```

Semantics:

```text
find(field, value)
≡
filter(eq(field, value), scan())
```

The difference is physical.

`find` exists because the Table may have an efficient index.

Example:

```text
INDEX(state)
```

can make:

```text
find(state, NY)
```

much cheaper than:

```text
scan → filter
```

---

# 14. `range`

Signature:

```js
range(field, bounds) -> Cursor
```

Bounds:

```js
{
  gt:  10,
  gte: 10,
  lt:  20,
  lte: 20
}
```

Examples:

```js
table.range('age', { gte: 18 })

table.range('age', {
  gte: 18,
  lt: 30
})
```

Semantics:

```text
range(field, bounds)
≡
filter(rangeExpr(field, bounds), scan())
```

Again, `range` is a physical capability.

It exists because an ordered index may execute the operation efficiently.

---

# 15. `count`

Signature:

```js
count() -> number
```

Semantically:

```text
count()
≡
COUNT(scan())
```

A storage implementation may return the count directly.

Therefore:

```js
table.count()
```

is an optimization capability.

The algebra must not depend on it.

---

# 16. Logical Relational Algebra

The core logical operations are:

```text
SOURCE
FILTER
PROJECT
DISTINCT
SORT
OFFSET
LIMIT
GROUP
AGGREGATE
JOIN
UNION
```

The exact public API may differ.

The internal IR must remain independent of the API.

---

# 17. Canonical Node

A query node is a plain object.

Unary operation:

```js
{
  op: 'filter',
  args: [expr],
  in: input
}
```

Example:

```js
{
  op: 'filter',
  args: [
    {
      op: 'gte',
      args: ['age', 18]
    }
  ],
  in: {
    op: 'source',
    name: 'users'
  }
}
```

Multi-input operation:

```js
{
  op: 'join',
  args: [condition],
  in: [left, right]
}
```

The important invariant is:

```text
node = POJO
```

No execution state is stored in the logical node.

---

# 18. Expression Nodes

Expressions use the same node model.

Example:

```js
{
  op: 'eq',
  args: ['status', 'active']
}
```

```js
{
  op: 'gte',
  args: ['age', 18]
}
```

Boolean expressions:

```js
{
  op: 'and',
  args: [
    { op: 'eq', args: ['status', 'active'] },
    { op: 'gte', args: ['age', 18] }
  ]
}
```

Operators should be generic data.

Do not encode expressions as JavaScript source strings.

---

# 19. Expression Evaluation

The baseline evaluator is simple.

Pseudocode:

```js
function evalExpr(expr, row) {
  const op = expr.op

  if (op === 'field')
    return row[expr.args[0]]

  if (op === 'value')
    return expr.args[0]

  if (op === 'eq')
    return value(expr.args[0], row) === value(expr.args[1], row)

  if (op === 'gte')
    return value(expr.args[0], row) >= value(expr.args[1], row)

  // ...
}
```

The actual implementation should use an operator map rather than a large switch when practical:

```js
const operators = {
  eq:  (a, b) => a === b,
  ne:  (a, b) => a !== b,
  gt:  (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt:  (a, b) => a < b,
  lte: (a, b) => a <= b,
}
```

The expression evaluator must be deterministic.

---

# 20. Core Expression Operators

Minimum:

```text
eq
ne
gt
gte
lt
lte
in
like
isNull
isNotNull
and
or
not
```

String and arithmetic functions can be extensions.

The core should remain small.

---

# 21. Baseline Executor

Every logical operation must have a fallback implementation based on `scan`.

Example:

```js
function* rows(cursor) {
  let row

  while ((row = cursor.next()) !== null)
    yield row
}
```

Conceptually:

```js
function execute(node) {
  switch (node.op) {

    case 'source':
      return node.table.scan()

    case 'filter':
      return filter(
        execute(node.in),
        node.args[0]
      )

    case 'project':
      return project(
        execute(node.in),
        node.args
      )

    // ...
  }
}
```

The real implementation may use function maps instead of a switch.

---

# 22. Filter

Logical semantics:

```text
FILTER(expr, input)
```

returns rows where:

```js
evalExpr(expr, row) === true
```

Baseline:

```js
function filter(cursor, expr) {
  return {
    next() {
      let row

      while ((row = cursor.next()) !== null) {
        if (evalExpr(expr, row))
          return row
      }

      return null
    },

    close() {
      cursor.close?.()
    }
  }
}
```

This is streaming.

It does not create an array.

---

# 23. Project

Logical semantics:

```text
PROJECT(fields, input)
```

Example:

```text
PROJECT(id,name)
```

Input:

```js
{
  id: 1,
  name: 'Alice',
  age: 30
}
```

Output:

```js
{
  id: 1,
  name: 'Alice'
}
```

Baseline implementation is streaming.

---

# 24. Limit

```text
LIMIT(n, input)
```

must stop requesting input after `n` rows.

This is important because:

```text
LIMIT 20
```

should not cause a million-row source to be completely scanned.

The cursor is allowed to remain lazy.

---

# 25. Offset

```text
OFFSET(n, input)
```

consumes and discards the first `n` rows.

An implementation may optimize this if the physical source supports seeking.

---

# 26. Sort

Baseline:

```text
input
 ↓
materialize
 ↓
sort
 ↓
cursor
```

Sorting normally requires materialization.

If the Table provides an ordered capability, the planner may eliminate the explicit sort.

---

# 27. Distinct

Baseline:

```js
const seen = new Set()
```

For each row:

```text
key(row)
if unseen:
    emit row
```

The implementation must define the key semantics.

For simple field projection:

```js
key = row[field]
```

For multiple fields:

```js
key = tuple(row, fields)
```

---

# 28. Group

`group` is a logical operation.

It must remain part of the algebra.

Example:

```text
GROUP(state)
```

transforms:

```text
Row stream
```

into:

```text
Group stream
```

A group conceptually contains:

```js
{
  key,
  rows
}
```

but the implementation does not need to materialize `rows` when an aggregate can be computed incrementally.

---

# 29. Aggregate

Examples:

```text
count
sum
min
max
avg
```

An aggregate should ideally expose:

```text
init
step
merge
result
```

Example:

```js
const count = {
  init: () => 0,

  step: n => n + 1,

  merge: (a, b) => a + b,

  result: n => n
}
```

This structure is important because:

```text
step
```

permits streaming,

while:

```text
merge
```

permits parallel aggregation.

---

# 30. Parallel Aggregation

Suppose the input is divided:

```text
partition A
partition B
partition C
partition D
```

Each worker performs:

```text
aggregate locally
```

producing:

```text
A'
B'
C'
D'
```

Then:

```text
merge(A', B', C', D')
```

produces the final result.

Therefore:

> **Associative merge is the fundamental property enabling parallel aggregation.**

This should be preserved in the aggregate contract.

---

# 31. Join

Logical form:

```text
JOIN(left, right, predicate)
```

Baseline implementation may use nested loops:

```js
for each leftRow:
  for each rightRow:
    if predicate(leftRow, rightRow):
      emit(join(leftRow, rightRow))
```

This is deliberately not optimal.

The planner may replace it with:

```text
hash join
index join
merge join
bitmap join
remote join
```

without changing the logical node.

---

# 32. Physical Capabilities

A Table capability is an optional implementation of a semantic operation.

Examples:

```text
get
find
range
count
bitmap
sort
group
aggregate
join
```

The planner can test capabilities by function presence.

Example:

```js
if (table.find)
  ...
```

No registry is required initially.

A future capability descriptor may be added if cost estimation requires more information.

---

# 33. Capability Selection

Given:

```text
FILTER(eq(name, "Alice"))
SOURCE(users)
```

the planner asks:

```text
Does users have get?
Does name identify the primary key?
Does users have find?
Is name indexed?
```

Possible result:

```text
FIND(users, name, Alice)
```

If no capability exists:

```text
SCAN(users)
FILTER(eq(name, Alice))
```

Correctness is identical.

---

# 34. Primary-Key Rewrite

Pattern:

```text
FILTER(eq(pk, value))
  SOURCE(table)
```

can become:

```text
GET(table, value)
```

provided:

```text
pk is unique
```

Execution:

```js
const row = table.get(value)
```

The result is converted into a one-row or empty cursor.

---

# 35. Equality-Index Rewrite

Pattern:

```text
FILTER(eq(field, value))
  SOURCE(table)
```

can become:

```text
FIND(table, field, value)
```

when:

```text
table.find
```

exists.

If multiple predicates exist:

```text
FILTER(eq(state, 'NY') AND age >= 18)
```

the planner may use:

```text
FIND(state, NY)
  FILTER(age >= 18)
```

---

# 36. Range Rewrite

Pattern:

```text
FILTER(gte(age, 18))
  SOURCE(table)
```

can become:

```text
RANGE(table, age, {gte:18})
```

For:

```text
age >= 18 AND age < 30
```

combine the predicates:

```text
RANGE(age, {
  gte: 18,
  lt: 30
})
```

This rewrite should happen before execution.

---

# 37. Filter Normalization

Adjacent filters:

```text
FILTER(A)
  FILTER(B)
    input
```

should normalize to:

```text
FILTER(AND(A,B))
  input
```

This gives the optimizer one predicate tree to analyze.

Then:

```text
AND(eq(pk,42), age >= 18)
```

can potentially become:

```text
GET(42)
FILTER(age >= 18)
```

---

# 38. Boolean Simplification

Minimum rules:

```text
AND(true, X)  → X
AND(false, X) → false

OR(false, X)  → X
OR(true, X)   → true

NOT(NOT(X))   → X
```

Also:

```text
FILTER(true, input)  → input
FILTER(false, input) → EMPTY
```

These are pure tree rewrites.

---

# 39. Projection Pushdown

Given:

```text
PROJECT(a,b)
  FILTER(eq(c,10))
    SOURCE(table)
```

the filter requires `c`.

Therefore the planner must retain:

```text
a
b
c
```

until filtering has completed.

It may push projection down only when required fields are preserved.

General rule:

> **A transformation may move toward the source only if it preserves the fields required by all operations above it.**

---

# 40. Limit Pushdown

`LIMIT` may be pushed downward only when semantics are preserved.

Safe example:

```text
LIMIT(0, X) → EMPTY
```

Potentially safe:

```text
PROJECT
  LIMIT
    X
```

may become:

```text
LIMIT
  PROJECT
    X
```

because projection preserves cardinality.

Not generally safe:

```text
FILTER
  LIMIT
    X
```

→

```text
LIMIT
  FILTER
    X
```

because filtering can remove rows.

The optimizer must therefore use explicit rewrite rules rather than arbitrary movement.

---

# 41. Bitmap Capability

Bitmap indexes are physical acceleration.

A Table may expose:

```js
bitmap(expr) -> Bitmap
```

or a more specialized capability.

The exact physical API may evolve.

The important semantic property is:

```text
Bitmap = set of matching row identities
```

Example:

```text
bitmap(status = active)
```

produces:

```text
{ 1, 4, 7, 12, 20, ... }
```

A second expression:

```text
bitmap(age >= 18)
```

produces another bitmap.

Boolean operations become:

```text
A AND B
A OR B
A AND NOT B
```

which are extremely cheap compared with row-by-row evaluation.

---

# 42. Bitmap Is Not the Row

A bitmap identifies candidate rows.

It does not need to contain complete row data.

Conceptually:

```text
Bitmap
   ↓
row ids
   ↓
materialize rows
```

This allows predicates to be evaluated before touching row payloads.

For example:

```text
status = active
AND
state = NY
AND
age >= 18
```

can become:

```text
B1 = bitmap(status = active)
B2 = bitmap(state = NY)
B3 = bitmap(age >= 18)

B = B1 AND B2 AND B3

B
 ↓
fetch matching rows
```

---

# 43. Bitmap and `find` Are Complementary

A single equality:

```text
state = NY
```

may use:

```text
find(state, NY)
```

A complex predicate:

```text
state = NY
AND
status = active
AND
age >= 18
```

may be better represented as bitmap operations.

Therefore the optimizer should not hard-code:

```text
indexed → find
```

It should eventually choose based on:

- selectivity
- available indexes
- estimated cost
- cardinality
- bitmap size
- row width
- downstream operations

The initial implementation can use simple rules.

Cost-based planning can come later.

---

# 44. Cost Model

The first planner does not need a sophisticated cost model.

Start with deterministic rules:

```text
PK equality      → GET
indexed equality → FIND
indexed range    → RANGE
bitmap available → BITMAP for complex predicates
otherwise        → SCAN + FILTER
```

Later introduce:

```js
cost(plan, stats)
```

where statistics may include:

```text
row count
distinct values
index cardinality
selectivity
row width
bitmap density
```

The optimizer remains independent of the storage implementation.

---

# 45. Statistics

Statistics are optional.

Possible Table metadata:

```js
stats: {
  rows: 1000000,

  fields: {
    state: {
      distinct: 50
    },

    status: {
      distinct: 5
    }
  }
}
```

Statistics must never be required for correctness.

They only improve planning.

---

# 46. Execution Plan

After optimization, the logical query becomes an executable plan.

Example:

```text
SOURCE users
  ↓
FILTER status = active
  ↓
FILTER age >= 18
  ↓
PROJECT id,name
  ↓
LIMIT 20
```

may compile to:

```text
FIND users status=active
  ↓
RANGE age>=18
  ↓
PROJECT id,name
  ↓
LIMIT 20
```

The execution plan may contain physical operations not present in the original query.

---

# 47. Planner Contract

Conceptually:

```js
plan = optimize(query)
```

Input:

```text
logical Node
```

Output:

```text
optimized Node / execution graph
```

The planner should be:

```text
pure
deterministic
side-effect free
```

It must not read rows.

It only inspects:

- node structure
- schema
- capabilities
- optional statistics

---

# 48. Executor Contract

Conceptually:

```js
cursor = execute(plan)
```

The executor is responsible for:

```text
opening sources
creating cursors
applying operators
closing resources
```

It must not change the logical meaning of the plan.

---

# 49. Terminal Execution

The public Query can expose:

```js
query()
```

and:

```js
query.run()
```

as equivalent terminal operations.

Conceptually:

```js
function run(query) {
  const logical = normalize(query)
  const plan = optimize(logical)
  return materialize(execute(plan))
}
```

For streaming APIs:

```js
query.cursor()
```

may return the execution cursor directly.

---

# 50. Page-Oriented Execution

The first implementation can materialize a bounded page:

```js
query.run({
  limit: 100
})
```

or:

```js
query.limit(100)()
```

The executor should stop requesting rows once the requested page is full.

Future pagination may return:

```js
{
  rows,
  next
}
```

where `next` represents continuation state.

The physical cursor must remain capable of lazy continuation.

---

# 51. Source Resolution

A source node contains logical identity:

```js
{
  op: 'source',
  name: 'users'
}
```

The executor resolves it to a Table.

For IODB:

```js
const db = IO('mydb/')
```

and:

```js
db.users
```

is a lazy source reference.

Conceptually:

```text
db.users
    ↓
source("users")
    ↓
mydb/users.table.json
    ↓
Table
```

Access to the underlying file must remain lazy.

Creating a query must not read the table.

---

# 52. Query Construction Must Be Pure

This must not execute:

```js
const q = db.users.status('active')
```

No scan.

No file read.

No index lookup.

No network request.

Only a semantic node is constructed.

Execution occurs only at:

```js
q()
```

or:

```js
q.run()
```

---

# 53. Fluent API Mapping

The public fluent API is syntactic sugar over nodes.

Example:

```js
db.users
  .status('active')
  .age.gte(18)
  .pick('id', 'name')
  .sort('name')
  .limit(20)
```

normalizes to:

```text
LIMIT
  SORT
    PROJECT
      FILTER
        FILTER
          SOURCE
```

The optimizer sees only the normalized representation.

---

# 54. Predicate Sugar

```js
users.status('active')
```

means:

```js
users.where(
  is.eq('status', 'active')
)
```

Similarly:

```js
users.age.gte(18)
```

means:

```js
users.where(
  is.gte('age', 18)
)
```

This syntax is implemented by Proxy.

No dynamic method needs to physically exist for every field.

---

# 55. `is` Expression Namespace

Example:

```js
is.eq('status', 'active')

is.gte('age', 18)

is.and(
  is.eq('state', 'NY'),
  is.gte('age', 18)
)
```

All return expression nodes.

Example:

```js
is.gte('age', 18)
```

returns:

```js
{
  op: 'gte',
  args: ['age', 18]
}
```

---

# 56. String Predicate Parser

This is optional syntax.

Example:

```js
users.where(
  'age >= 18 && status = "active"'
)
```

The parser converts it to:

```js
{
  op: 'and',
  args: [
    {
      op: 'gte',
      args: ['age', 18]
    },
    {
      op: 'eq',
      args: ['status', 'active']
    }
  ]
}
```

The parser must not generate JavaScript code.

It must generate the same expression nodes used by `is`.

---

# 57. Parser Scope

The first parser only needs:

```text
identifier
number
string
null

=
==
!=
>
>=
<
<=

&&
||
!
(
)
```

Optional:

```text
IN
LIKE
IS NULL
```

Do not implement a complete SQL expression language initially.

The objective is to reach the same IR.

---

# 58. SQL Frontend

SQL is another frontend.

Example:

```sql
SELECT id, name
FROM users
WHERE status = 'active'
  AND age >= 18
ORDER BY name
LIMIT 20
```

must become the same logical plan:

```text
LIMIT
  SORT
    PROJECT
      FILTER
        SOURCE
```

The engine should never have two execution paths:

```text
SQL executor
JS executor
```

Instead:

```text
SQL parser ─┐
            ├→ Query IR → Planner → Executor
JS API ─────┤
            │
SOML ───────┤
            │
future API ─┘
```

---

# 59. Mutations

Mutation is outside the minimal read-oriented Table contract.

Future Table capabilities may include:

```js
insert(row)
update(...)
remove(...)
```

Transactions may later include:

```js
begin()
commit()
rollback()
```

Do not make these dependencies of the relational read engine.

The read algebra should remain usable over immutable and remote sources.

---

# 60. Functional Boundary

The intended functional structure is:

```text
query
  ↓
normalize(query)
  ↓
logical IR
  ↓
optimize(IR)
  ↓
physical IR
  ↓
execute(plan)
  ↓
cursor
```

Only the final execution layer interacts with mutable storage state.

This makes:

```text
query construction
normalization
optimization
expression evaluation
```

easy to test independently.

---

# 61. Core Data Model

The minimum internal model is:

```js
// Logical relation
{
  op,
  args,
  in
}

// Expression
{
  op,
  args
}

// Multi-input relation
{
  op,
  args,
  in: [left, right]
}

// Table
{
  schema,
  scan,

  get?,
  find?,
  range?,
  count?,

  filter?,
  project?,
  sort?,
  group?,
  aggregate?,
  join?,
  bitmap?
}
```

No class hierarchy is required.

---

# 62. Node Invariants

Every Node must satisfy:

```text
1. op is a string.
2. args is an array when present.
3. in is absent or a Node or Node[].
4. Nodes contain semantic data only.
5. Nodes contain no cursors.
6. Nodes contain no row data unless it is a literal argument.
7. Nodes do not execute.
```

This is critical.

A plan node is a description, not an execution object.

---

# 63. Capability Invariants

A capability:

```text
must preserve logical semantics
must return compatible data
must not change query meaning
may be more efficient
```

Therefore:

```text
FIND(field,value)
```

must produce exactly the rows that:

```text
FILTER(eq(field,value), SCAN)
```

would produce.

Likewise:

```text
RANGE
```

must be semantically equivalent to its corresponding filter.

---

# 64. Capability Verification

During development, capabilities should be testable against the baseline.

For example:

```js
const expected = collect(
  execute(
    filter(
      eq('state', 'NY'),
      source(table)
    )
  )
)

const actual = collect(
  table.find('state', 'NY')
)

check(equal(actual, expected))
```

This is important because optimization must never change semantics.

---

# 65. Reference Executor

The first implementation should include a deliberately simple reference executor.

It should use only:

```text
schema
scan
```

and implement everything else functionally.

This executor becomes:

```text
semantic oracle
```

for optimized execution.

Example:

```text
Reference executor
        │
        ├──── compare ──── Optimized executor
        │
        └──── expected semantics
```

This greatly simplifies testing.

---

# 66. Testing Strategy

Every optimizer rule should have:

```text
logical plan
optimized plan
reference result
optimized result
```

Example:

```text
INPUT:
FILTER(eq(id,42), SOURCE(users))

EXPECTED PLAN:
GET(users,42)

EXPECTED RESULT:
same as reference executor
```

Tests should verify both:

```text
plan shape
result equality
```

---

# 67. Optimizer Rule Format

A rule can conceptually be:

```js
function rule(node, context) {
  if (!matches(node))
    return node

  return rewrite(node)
}
```

Rules are pure.

Example:

```js
function filterPk(node, ctx) {
  // FILTER(eq(pk,value), SOURCE(table))
  // → GET(table,value)
}
```

Rules can be repeatedly applied until stable.

---

# 68. Normalization Pipeline

Recommended order:

```text
parse/build
    ↓
normalize expressions
    ↓
normalize relational nodes
    ↓
simplify boolean expressions
    ↓
merge adjacent filters
    ↓
push safe predicates/projections
    ↓
select physical capabilities
    ↓
produce execution plan
```

This keeps optimization deterministic.

---

# 69. Fixpoint Optimization

Optimization may be repeated:

```js
while (changed)
  plan = rewrite(plan)
```

until:

```text
plan == previousPlan
```

The first implementation may instead perform a fixed sequence of passes.

Avoid an overly sophisticated rule engine initially.

---

# 70. Execution Graph

The optimized plan can remain a tree initially.

Later, identical subplans may be shared.

Example:

```text
              SOURCE(users)
                    │
                  FILTER
                    │
             ┌──────┴──────┐
             ▼             ▼
         PROJECT          GROUP
             │             │
             ▼             ▼
             Q1            Q2
```

The same representation can therefore evolve from:

```text
tree
```

to:

```text
DAG
```

without changing logical semantics.

---

# 71. Parallel Execution

Parallelism should emerge from independent streams.

Required properties:

```text
independent cursors
no hidden global cursor state
partitionable scans when supported
associative aggregates
mergeable intermediate results
```

Optional capability:

```js
scan({ partition })
```

or:

```js
partitions()
```

The exact API can be added later.

The baseline remains:

```js
scan()
```

---

# 72. Remote Execution

A remote Table can expose the same contract:

```js
{
  schema,
  scan,
  get,
  find,
  range
}
```

Its implementation might translate these operations into network requests.

The relational engine does not need to know that the source is remote.

A future remote capability may expose:

```text
filter
project
sort
group
aggregate
```

allowing computation to be pushed to the remote server.

This is the same optimization principle used locally.

---

# 73. Pushdown

Pushdown means:

> execute an operation closer to the data source when that source can perform it efficiently.

Example:

```text
PROJECT
  FILTER
    SOURCE(remote)
```

can become:

```text
remote.query(
  filter,
  project
)
```

if the remote Table provides that capability.

The logical query remains unchanged.

---

# 74. Delegation Principle

Every layer should delegate rather than duplicate.

```text
SQL parser
    → query IR

Query API
    → query IR

Algebra
    → logical semantics

Planner
    → physical strategy

Table
    → storage capabilities

Storage
    → actual bytes/indexes
```

Do not make the planner implement storage.

Do not make the Table implement SQL.

Do not make SQL bypass the planner.

Do not make the executor duplicate storage indexes.

---

# 75. Recommended Implementation Modules

A minimal implementation can be divided into:

```text
table.js
cursor.js
expr.js
algebra.js
planner.js
executor.js
bitmap.js
query.js
sql.js
```

Initial dependency direction:

```text
query
  ↓
algebra
  ↓
planner
  ↓
executor
  ↓
table
```

`expr` is shared by:

```text
query
algebra
planner
executor
```

`bitmap` is physical and should not leak into logical expressions.

---

# 76. Minimal Pseudocode

## Table

```js
const table = {
  schema,

  scan() {
    return cursor(...)
  }
}
```

## Source

```js
function source(table) {
  return {
    op: 'source',
    table
  }
}
```

## Filter

```js
function filter(expr, input) {
  return {
    op: 'filter',
    args: [expr],
    in: input
  }
}
```

## Project

```js
function project(fields, input) {
  return {
    op: 'project',
    args: [fields],
    in: input
  }
}
```

## Limit

```js
function limit(n, input) {
  return {
    op: 'limit',
    args: [n],
    in: input
  }
}
```

---

# 77. Minimal Execution Pseudocode

```js
function execute(node) {

  if (node.op === 'source')
    return node.table.scan()

  if (node.op === 'filter')
    return filterCursor(
      execute(node.in),
      node.args[0]
    )

  if (node.op === 'project')
    return projectCursor(
      execute(node.in),
      node.args[0]
    )

  if (node.op === 'limit')
    return limitCursor(
      execute(node.in),
      node.args[0]
    )
}
```

This is sufficient to build the first working engine.

---

# 78. Minimal Planner Pseudocode

```js
function optimize(node) {

  node = normalize(node)

  node = simplify(node)

  node = optimizeChildren(node)

  if (isPkEquality(node))
    return makeGet(node)

  if (isIndexedEquality(node))
    return makeFind(node)

  if (isIndexedRange(node))
    return makeRange(node)

  return node
}
```

The implementation can initially be this simple.

---

# 79. Reference Execution vs Optimized Execution

The engine should conceptually provide two paths:

```text
reference:
    logical plan → generic executor

optimized:
    logical plan → optimizer → physical executor
```

For every query:

```js
equal(
  runReference(query),
  runOptimized(query)
)
```

must hold.

This gives the optimizer a permanent correctness oracle.

---

# 80. Ideal Architecture

The complete conceptual architecture is:

```text
                 USER
                  │
        ┌─────────┼─────────┐
        ▼         ▼         ▼
       JS        SQL       SOML
        │         │         │
        └─────────┼─────────┘
                  ▼
             QUERY BUILDER
                  │
                  ▼
             LOGICAL IR
                  │
                  ▼
              NORMALIZER
                  │
                  ▼
              OPTIMIZER
                  │
        ┌─────────┼─────────┐
        ▼         ▼         ▼
       GET       FIND      RANGE
        │         │         │
        └─────────┼─────────┘
                  ▼
             BITMAP / INDEX
                  │
                  ▼
                SCAN
                  │
        ┌─────────┼─────────┐
        ▼         ▼         ▼
       IODB      MEMORY    REMOTE
```

Every arrow represents delegation.

---

# 81. What Is Fundamental

The irreducible foundation is surprisingly small:

```text
Row
Cursor
Table
Node
Expression
Planner
Executor
```

And the minimum Table contract is:

```js
{
  schema,
  scan
}
```

Everything else is acceleration.

This is the key architectural property.

---

# 82. Ideal Physical Foundation

For the intended IODB engine, the recommended Table is:

```js
{
  schema,

  scan,
  get,
  find,
  range,
  count
}
```

This gives the planner enough information to implement the first serious optimizations:

```text
scan
get
find
range
count
```

while preserving a universal fallback.

---

# 83. Future Physical Extensions

The interface can grow naturally:

```text
bitmap
partitions
ordered scan
filter pushdown
project pushdown
sort pushdown
group pushdown
aggregate pushdown
join pushdown
statistics
transactions
snapshot
```

None of these should be required by the logical algebra.

---

# 84. Implementation Order

A simple implementation should follow this order.

### Phase 1 — Cursor

Implement:

```text
Cursor
next()
close()
```

and tests for independent cursors.

### Phase 2 — Table

Implement:

```text
schema
scan
```

using an in-memory array.

### Phase 3 — Expressions

Implement:

```text
eq
ne
gt
gte
lt
lte
and
or
not
```

### Phase 4 — Algebra

Implement:

```text
source
filter
project
limit
offset
sort
distinct
group
aggregate
join
union
```

### Phase 5 — Reference Executor

Make every operation work using:

```text
scan
```

only.

### Phase 6 — Physical Capabilities

Add:

```text
get
find
range
count
```

### Phase 7 — Planner

Implement deterministic rewrites:

```text
PK → GET
indexed equality → FIND
indexed range → RANGE
count → COUNT
```

### Phase 8 — Bitmap

Add bitmap indexes without modifying the logical algebra.

### Phase 9 — Cost Model

Add statistics and cost estimation.

### Phase 10 — Query API

Add Proxy/fluent syntax.

### Phase 11 — SQL

Compile SQL to the same IR.

---

# 85. First Concrete Target

The first complete end-to-end test should be:

```js
const table = memoryTable([
  { id: 1, name: 'Alice', age: 30, state: 'NY' },
  { id: 2, name: 'Bob',   age: 16, state: 'NY' },
  { id: 3, name: 'Carol', age: 25, state: 'CA' }
])

const query =
  limit(
    20,
    project(
      ['id', 'name'],
      filter(
        and(
          eq('state', 'NY'),
          gte('age', 18)
        ),
        source(table)
      )
    )
  )
```

Reference result:

```js
[
  { id: 1, name: 'Alice' }
]
```

Then add:

```js
table.find
```

and verify that the optimized plan produces exactly the same result.

Then add:

```js
table.range
```

and repeat.

Then bitmap.

The logical query never changes.

---

# 86. Final Contract

The central contract of the entire engine is:

```text
LOGICAL SEMANTICS
        ↓
must remain constant
        ↓
PHYSICAL STRATEGY
        ↓
may change freely
```

Therefore:

```text
                 SAME QUERY
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
      SCAN          INDEX       BITMAP
        │            │            │
        └────────────┼────────────┘
                     ▼
                SAME RESULT
```

The engine is successful when increasingly sophisticated storage mechanisms can be added **without increasing the complexity of the relational algebra**.

---

# 87. Core Design Law

> **The algebra expresses semantics.**
>
> **The planner expresses strategy.**
>
> **The Table exposes capabilities.**
>
> **The storage owns physical data structures.**
>
> **The executor connects them.**

And, consequently:

> **If a storage engine already knows how to perform an operation efficiently, the relational engine should delegate to it rather than reproduce that knowledge.**

This is the foundation for an engine in which:

```text
SQL
JS
SOML
future APIs
       ↓
   one semantic IR
       ↓
   one optimizer
       ↓
   many physical strategies
```

with:

```text
scan
index
range
bitmap
parallelism
remote pushdown
```

all becoming interchangeable implementation details of the same relational semantics.

Isso fecha o documento anterior num nível que já serve como **contrato de implementação**, não apenas como arquitetura conceitual. O ponto mais importante para a próxima etapa é manter o **reference executor**: ele será o “oráculo semântico” contra o qual cada otimização — `get`, `find`, `range`, bitmap, pushdown etc. — poderá ser testada. Isso permite evoluir agressivamente o planner sem colocar a correção da álgebra em risco.

