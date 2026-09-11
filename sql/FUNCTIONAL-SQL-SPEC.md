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

* memory
* IODB
* JSON
* JSONL
* CSV
* SQLite
* remote databases
* HTTP APIs
* generated data
* partitioned data
* indexed data
* bitmap indexes
* future storage engines

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

| Property   | Meaning                                             |
| ---------- | --------------------------------------------------- |
| `pk`       | field is part of primary key                        |
| `unique`   | value identifies at most one row                    |
| `indexed`  | equality/range lookup may be accelerated            |
| `null`     | field may contain null                              |
| `autoinc`  | storage can generate increasing values              |
| `autohash` | storage can generate deterministic hash identifiers |
| `type`     | logical field type                                  |

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

* nested queries
* concurrent queries
* parallel execution
* multiple consumers
* pagination

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

* selectivity
* available indexes
* estimated cost
* cardinality
* bitmap size
* row width
* downstream operations

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

* node structure
* schema
* capabilities
* optional statistics

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
