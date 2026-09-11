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

* memory
* JSON
* JSONL
* CSV
* an index
* another database
* HTTP
* a remote shard
* a generated/virtual source

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

* numeric fields
* dates
* ordered strings
* timestamps
* ordered indexes

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
