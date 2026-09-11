/**
 * Minimal functional relational algebra.
 *
 * - All constructors return pure plan nodes { op, args?, in?, name? }
 * - Construction never executes (no scan, no IO)
 * - Fluent sugar via Proxy maps to the same nodes
 * - SQL parser (later) only needs to call these factories — brainless
 *
 * Style: factory closures with shared scope.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isNode = (x) => x && typeof x === 'object' && typeof x.op === 'string'

/**
 * asExpr — values become lit; nodes pass through.
 * Column names must use asField() / is.field() explicitly.
 */
const asExpr = (x) => {
  if (isNode(x)) return x
  return { op: 'lit', args: [x] }
}

const asField = (x) => {
  if (isNode(x) && x.op === 'field') return x
  if (typeof x === 'string') return { op: 'field', args: [x] }
  throw new Error(`expected field name, got ${JSON.stringify(x)}`)
}

// ---------------------------------------------------------------------------
// createAlgebra — shared scope for expression + relation factories
// ---------------------------------------------------------------------------

export const createAlgebra = () => {
  // ----- Expression namespace (is.*) -----
  const is = {
    lit:   (v)      => ({ op: 'lit',   args: [v] }),
    field: (name)   => ({ op: 'field', args: [String(name)] }),

    // Left side of comparisons is usually a field; accept string as field name.
    // Right side is always treated as value (lit) unless already a node.
    _bin(op, a, b) {
      const left = typeof a === 'string' ? is.field(a) : asExpr(a)
      const right = asExpr(b)
      return { op, args: [left, right] }
    },
    eq:  (a, b) => is._bin('eq',  a, b),
    ne:  (a, b) => is._bin('ne',  a, b),
    gt:  (a, b) => is._bin('gt',  a, b),
    gte: (a, b) => is._bin('gte', a, b),
    lt:  (a, b) => is._bin('lt',  a, b),
    lte: (a, b) => is._bin('lte', a, b),

    and: (...xs) => ({ op: 'and', args: xs.map(asExpr) }),
    or:  (...xs) => ({ op: 'or',  args: xs.map(asExpr) }),
    not: (e)     => ({ op: 'not', args: [asExpr(e)] }),

    isNull:    (e) => ({ op: 'is_null',     args: [typeof e === 'string' ? is.field(e) : asExpr(e)] }),
    isNotNull: (e) => ({ op: 'is_not_null', args: [typeof e === 'string' ? is.field(e) : asExpr(e)] }),

    between: (e, lo, hi) => ({
      op: 'between',
      args: [typeof e === 'string' ? is.field(e) : asExpr(e), asExpr(lo), asExpr(hi)],
    }),
    in: (e, list) => ({
      op: 'in',
      args: [typeof e === 'string' ? is.field(e) : asExpr(e), list],
    }),
    exists: (rel) => ({ op: 'exists', args: [rel] }),

    add: (a, b) => ({ op: 'add', args: [asExpr(a), asExpr(b)] }),
    sub: (a, b) => ({ op: 'sub', args: [asExpr(a), asExpr(b)] }),
    mul: (a, b) => ({ op: 'mul', args: [asExpr(a), asExpr(b)] }),
    div: (a, b) => ({ op: 'div', args: [asExpr(a), asExpr(b)] }),

    upper:    (e)     => ({ op: 'upper',    args: [asExpr(e)] }),
    lower:    (e)     => ({ op: 'lower',    args: [asExpr(e)] }),
    length:   (e)     => ({ op: 'length',   args: [asExpr(e)] }),
    abs:      (e)     => ({ op: 'abs',      args: [asExpr(e)] }),
    coalesce: (...xs) => ({ op: 'coalesce', args: xs.map(asExpr) }),
    cast:     (e, t)  => ({ op: 'cast',     args: [asExpr(e), t] }),
    like:     (e, pat) => ({ op: 'like', args: [typeof e === 'string' ? is.field(e) : asExpr(e), asExpr(pat)] }),
    case:     (branches, elseVal = null) => ({
      op: 'case',
      args: [
        ...(branches || []).flatMap((b) => [asExpr(b.when), asExpr(b.then)]),
        elseVal != null ? asExpr(elseVal) : { op: 'lit', args: [null] },
      ],
    }),
  }

  // ----- Relation constructors (pure) -----
  const source   = (name) => ({ op: 'source', name: String(name) })

  const filter   = (input, expr) => ({ op: 'filter',   in: input, args: [asExpr(expr)] })
  const project  = (input, cols) => ({
    op: 'project',
    in: input,
    args: cols.map((c) => {
      if (typeof c === 'string') return asField(c)
      if (isNode(c)) return c
      // { expr, as }
      if (c && c.expr != null) return { op: 'alias', args: [asExpr(c.expr), c.as] }
      throw new Error(`invalid project col: ${JSON.stringify(c)}`)
    }),
  })
  const sort = (input, keys) => ({
    op: 'sort',
    in: input,
    args: (Array.isArray(keys) ? keys : [keys]).map((k) => {
      if (typeof k === 'string') return { expr: asField(k), dir: 'asc' }
      if (k && k.expr != null) return { expr: asExpr(k.expr), dir: k.dir === 'desc' ? 'desc' : 'asc' }
      throw new Error(`invalid sort key: ${JSON.stringify(k)}`)
    }),
  })
  const limit    = (input, n) => ({ op: 'limit',    in: input, args: [Number(n)] })
  const offset   = (input, n) => ({ op: 'offset',   in: input, args: [Number(n)] })
  const distinct = (input, cols) => ({
    op: 'distinct',
    in: input,
    ...(cols ? { args: cols.map(asField) } : {}),
  })
  const join = (left, right, spec = {}) => ({
    op: 'join',
    in: [left, right],
    args: [{
      type: spec.type || 'inner',
      on: spec.on != null ? asExpr(spec.on) : null,
    }],
  })
  const group = (input, keys) => ({
    op: 'group',
    in: input,
    args: (Array.isArray(keys) ? keys : [keys]).map(asExpr),
  })
  const aggregate = (input, aggs) => ({
    op: 'aggregate',
    in: input,
    args: aggs.map((a) => ({
      fn: a.fn,
      ...(a.star ? { star: true } : {}),
      ...(a.expr != null ? { expr: asExpr(a.expr) } : {}),
      ...(a.as != null ? { as: a.as } : {}),
    })),
  })
  const union = (left, right, all = false) => ({
    op: 'union',
    in: [left, right],
    args: [{ all: !!all }],
  })
  const insert = (name, rows) => ({ op: 'insert', name, args: [rows] })
  const update = (name, setMap, where) => ({
    op: 'update', name, args: [setMap, where || null],
  })
  const remove = (name, where) => ({ op: 'delete', name, args: [where || null] })
  const createTableStmt = (name, schema) => ({ op: 'create_table', name, args: [schema] })

  const withCte = (ctes, main) => ({
    op: 'with',
    args: ctes, // [{ name, rel }]
    in: main,
  })

  // ----- Fluent query wrapper -----
  // Wraps a relation node and exposes chainable methods that only build nodes.
  // Execution is explicit: q() or q.run() later (not implemented here).
  const query = (node) => {
    if (!isNode(node)) throw new Error('query() expects a plan node')

    const self = {
      /** underlying plan node (read-only view) */
      get node() { return node },

      // explicit relational ops
      where(expr)   { return query(filter(node, expr)) },
      filter(expr)  { return query(filter(node, expr)) },
      pick(...cols) { return query(project(node, cols)) },
      project(...cols) { return query(project(node, cols)) },
      sort(...keys) {
        // .sort('name') or .sort({ expr:'age', dir:'desc' }) or multiple
        const flat = keys.length === 1 && Array.isArray(keys[0]) ? keys[0] : keys
        return query(sort(node, flat))
      },
      orderBy(...keys) { return self.sort(...keys) },
      limit(n)      { return query(limit(node, n)) },
      offset(n)     { return query(offset(node, n)) },
      distinct(...cols) {
        return query(cols.length ? distinct(node, cols) : distinct(node))
      },

      // join helpers
      join(right, on, type = 'inner') {
        const r = isNode(right) ? right : (right?.node ?? right)
        return query(join(node, r, { type, on }))
      },
      leftJoin(right, on) { return self.join(right, on, 'left') },

      groupBy(...keys) { return query(group(node, keys)) },
      agg(...aggs)     { return query(aggregate(node, aggs)) },

      // identity / debug
      toJSON() { return node },
      valueOf() { return node },
      [Symbol.for('nodejs.util.inspect.custom')]() { return node },
    }

    // Proxy for field sugar:
    //   q.status('active')  →  where(eq(field('status'), lit('active')))
    //   q.age.gte(18)       →  where(gte(field('age'), lit(18)))
    return new Proxy(self, {
      get(target, prop, receiver) {
        if (prop in target || typeof prop === 'symbol') {
          return Reflect.get(target, prop, receiver)
        }
        // field accessor chain: q.age → FieldChain
        return createFieldChain(query, node, String(prop))
      },
    })
  }

  /**
   * FieldChain enables:
   *   q.age.gte(18)
   *   q.status('active')          // sugar for eq
   *   q.name                      // just a field ref if needed later
   */
  const createFieldChain = (queryFn, baseNode, fieldName) => {
    const fieldExpr = is.field(fieldName)

    const chain = {
      // comparison methods
      eq:  (v) => queryFn(filter(baseNode, is.eq(fieldExpr, v))),
      ne:  (v) => queryFn(filter(baseNode, is.ne(fieldExpr, v))),
      gt:  (v) => queryFn(filter(baseNode, is.gt(fieldExpr, v))),
      gte: (v) => queryFn(filter(baseNode, is.gte(fieldExpr, v))),
      lt:  (v) => queryFn(filter(baseNode, is.lt(fieldExpr, v))),
      lte: (v) => queryFn(filter(baseNode, is.lte(fieldExpr, v))),
      isNull:    () => queryFn(filter(baseNode, is.isNull(fieldExpr))),
      isNotNull: () => queryFn(filter(baseNode, is.isNotNull(fieldExpr))),
      between: (lo, hi) => queryFn(filter(baseNode, is.between(fieldExpr, lo, hi))),
      in: (list) => queryFn(filter(baseNode, is.in(fieldExpr, list))),

      // allow q.status('active') as shorthand for q.status.eq('active')
      // by making the chain callable
    }

    const fn = (value) => queryFn(filter(baseNode, is.eq(fieldExpr, value)))
    Object.assign(fn, chain)
    // expose the field expression itself if someone does q.age without calling
    fn.expr = fieldExpr
    fn.field = fieldName
    return fn
  }

  // ----- Catalog / source entry point -----
  // db.users  →  query(source('users'))
  // Never touches storage.
  const createDb = (resolver /* optional (name) => Table, unused here */) => {
    return new Proxy({}, {
      get(_t, prop) {
        if (typeof prop === 'symbol') return undefined
        // reserved
        if (prop === 'then') return undefined // avoid thenable trap
        return query(source(String(prop)))
      },
    })
  }

  // Public surface of the algebra
  return {
    is,
    // relation ctors
    source, filter, project, sort, limit, offset, distinct,
    join, group, aggregate, union, withCte,
    insert, update, remove, createTableStmt,
    // fluent
    query,
    createDb,
    // utils
    asExpr, asField, isNode,
  }
}

// default singleton for convenience (still pure)
export const algebra = createAlgebra()
export const {
  is, source, filter, project, sort, limit, offset, distinct,
  join, group, aggregate, withCte, query, createDb,
  // mutations via algebra return

} = algebra
// asExpr / isNode are already declared at module top-level and exported via the factory return when needed

