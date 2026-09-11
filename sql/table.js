/**
 * High-level Table + Cursor services for the relational engine.
 *
 * Contract:
 *   - Engine only navigates plan nodes and optimizes.
 *   - All data access and physical work goes through Table / Cursor.
 *   - { schema, scan } is sufficient for correctness.
 *   - get / find / range / count are optional capabilities.
 *   - Construction of plans never calls these (purity).
 *
 * Style: factory closures with shared scope.
 */

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

/** Minimal pull cursor: { next() → row|null, close?() } */
export const createCursor = (impl) => {
  const cursor = {
    next: impl.next,
    close: impl.close || (() => {}),
    // convenience: materialize remaining rows
    collect() {
      const rows = []
      let row
      while ((row = this.next()) != null) rows.push(row)
      return rows
    },
    // make it iterable
    [Symbol.iterator]() {
      return {
        next: () => {
          const value = cursor.next()
          return value == null ? { done: true } : { done: false, value }
        },
      }
    },
  }
  return cursor
}

/** Cursor from an in-memory array (independent position per cursor) */
export const arrayCursor = (rows) => {
  let i = 0
  return createCursor({
    next() {
      if (i >= rows.length) return null
      return rows[i++]
    },
  })
}

/** Empty cursor */
export const emptyCursor = () => createCursor({ next: () => null })

/**
 * Transform a cursor through a row function (filter / map style).
 * fn(row) → row | null   (null = skip)
 */
export const mapCursor = (input, fn) => {
  return createCursor({
    next() {
      let row
      while ((row = input.next()) != null) {
        const out = fn(row)
        if (out != null) return out
      }
      return null
    },
    close() { input.close?.() },
  })
}

/** Limit / offset over a cursor */
export const limitCursor = (input, limit, offset = 0) => {
  let seen = 0
  let emitted = 0
  return createCursor({
    next() {
      while (true) {
        const row = input.next()
        if (row == null) return null
        if (seen++ < offset) continue
        if (emitted++ >= limit) return null
        return row
      }
    },
    close() { input.close?.() },
  })
}

// ---------------------------------------------------------------------------
// Schema normalization (SOML-style DSL → POJO)
// ---------------------------------------------------------------------------

/**
 * Normalize schema DSL:
 *   { 'id number pk autoinc': 0, 'name string indexed': '' }
 * into:
 *   { fields: { id: { type, pk, autoinc, default, ... }, ... }, pk, indexed }
 */
export const normalizeSchema = (raw) => {
  if (!raw) return { fields: {}, pk: null, indexed: [] }
  if (raw.fields) return raw // already normalized

  const fields = {}
  let pk = null
  const indexed = []

  for (const [key, defaultValue] of Object.entries(raw)) {
    // key = "name type mod1 mod2|mod3"
    const parts = key.trim().split(/\s+/)
    const name = parts[0]
    const type = parts[1] || 'any'
    const mods = parts.slice(2).join(' ').split(/[|\s]+/).filter(Boolean)

    const meta = {
      name,
      type,
      default: defaultValue,
      pk: false,
      unique: false,
      indexed: false,
      nullable: false,
      autoinc: false,
      autohash: false,
    }

    for (const m of mods) {
      if (m === 'pk') meta.pk = true
      else if (m === 'unique') meta.unique = true
      else if (m === 'indexed' || m === 'index') meta.indexed = true
      else if (m === 'null' || m === 'nullable') meta.nullable = true
      else if (m === 'autoinc') meta.autoinc = true
      else if (m === 'autohash') meta.autohash = true
    }

    if (meta.pk) {
      meta.unique = true
      meta.indexed = true
      pk = name
    }
    if (meta.indexed && !indexed.includes(name)) indexed.push(name)

    fields[name] = meta
  }

  return { fields, pk, indexed }
}

// ---------------------------------------------------------------------------
// createTable — high-level Table factory
// ---------------------------------------------------------------------------

/**
 * createTable(options) → Table
 *
 * Options:
 *   schema   – DSL or normalized
 *   rows     – initial rows (copied)
 *   name     – optional logical name
 *
 * Always provides:
 *   schema, scan, count
 *   get (if pk), find, range (array-based, always available)
 *   insert, update, remove  (mutation — outside pure read path)
 *
 * Engine only needs to call the read surface.
 */
export const createTable = (options = {}) => {
  const schema = normalizeSchema(options.schema || {})
  const name = options.name || null

  // physical store (mutable; isolated from plan construction)
  let rows = Array.isArray(options.rows) ? options.rows.map((r) => ({ ...r })) : []
  let autoinc = 0

  // derive next autoinc from existing data if pk is autoinc
  if (schema.pk && schema.fields[schema.pk]?.autoinc) {
    for (const r of rows) {
      const v = r[schema.pk]
      if (typeof v === 'number' && v > autoinc) autoinc = v
    }
  }

  // ----- core read API -----

  const scan = () => arrayCursor(rows)

  const count = (predicate) => {
    if (!predicate) return rows.length
    let n = 0
    for (const r of rows) if (predicate(r)) n++
    return n
  }

  /** Primary-key lookup — O(n) baseline; real indexes can replace later */
  const get = (key) => {
    if (!schema.pk) return null
    for (const r of rows) {
      if (r[schema.pk] === key) return { ...r }
    }
    return null
  }

  /** Equality scan on a field — capability; engine may prefer this over filter+scan */
  const find = (field, value) => {
    const out = []
    for (const r of rows) {
      if (r[field] === value) out.push({ ...r })
    }
    return arrayCursor(out)
  }

  /**
   * Range on a field.
   * bounds = { gt?, gte?, lt?, lte? }
   */
  const range = (field, bounds = {}) => {
    const out = []
    for (const r of rows) {
      const v = r[field]
      if (v == null) continue
      if (bounds.gt  != null && !(v >  bounds.gt))  continue
      if (bounds.gte != null && !(v >= bounds.gte)) continue
      if (bounds.lt  != null && !(v <  bounds.lt))  continue
      if (bounds.lte != null && !(v <= bounds.lte)) continue
      out.push({ ...r })
    }
    // stable-ish order by field for ordered capability consumers
    out.sort((a, b) => (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0))
    return arrayCursor(out)
  }

  // ----- mutation (used by DML layer / tests; not part of pure read algebra) -----

  const insert = (row) => {
    const r = { ...row }
    // defaults
    for (const [fname, meta] of Object.entries(schema.fields)) {
      if (r[fname] === undefined) {
        if (meta.autoinc && meta.pk) {
          autoinc += 1
          r[fname] = autoinc
        } else if (meta.default !== undefined) {
          r[fname] = meta.default
        }
      }
    }
    rows.push(r)
    return { ...r }
  }

  const update = (predicate, patch) => {
    let n = 0
    rows = rows.map((r) => {
      if (!predicate(r)) return r
      n++
      return { ...r, ...patch }
    })
    return n
  }

  const remove = (predicate) => {
    const before = rows.length
    rows = rows.filter((r) => !predicate(r))
    return before - rows.length
  }

  /** Replace all rows (for tests / load) */
  const load = (newRows) => {
    rows = newRows.map((r) => ({ ...r }))
    return rows.length
  }

  /** Snapshot for transactions (copy-on-write friendly) */
  const snapshot = () => createTable({
    schema,
    name,
    rows: rows.map((r) => ({ ...r })),
  })

  // capability flags (optimizer reads these)
  const capabilities = {
    scan: true,
    get: !!schema.pk,
    find: true,
    range: true,
    count: true,
    filter: false, // not pushed yet
    group: false,
  }

  const table = {
    name,
    schema,
    capabilities,

    // fundamental
    scan,
    count,

    // index-style capabilities
    get,
    find,
    range,

    // mutation (outside pure read path)
    insert,
    update,
    remove,
    load,
    snapshot,

    // debug
    get _rows() { return rows },
    toJSON() {
      return { name, schema, rowCount: rows.length, capabilities }
    },
  }

  return table
}

// ---------------------------------------------------------------------------
// Catalog — name → Table resolution (what execute uses for source nodes)
// ---------------------------------------------------------------------------

export const createCatalog = () => {
  const tables = new Map()

  const register = (name, table) => {
    tables.set(String(name), table)
    return api
  }

  const resolve = (name) => {
    const t = tables.get(String(name))
    if (!t) throw new Error(`unknown table: ${name}`)
    return t
  }

  const has = (name) => tables.has(String(name))

  const list = () => [...tables.keys()]

  const api = { register, resolve, has, list, tables }
  return api
}
