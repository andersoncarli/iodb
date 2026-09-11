/**
 * Execute — tree navigation only.
 *
 * Responsibilities:
 *   - walk plan nodes
 *   - resolve source → Table via catalog
 *   - evaluate expressions against a row
 *   - compose Cursors (filter / project / sort / limit / join / …)
 *
 * Does NOT:
 *   - parse SQL
 *   - build plans
 *   - own storage
 *
 * All physical work is delegated to Table + Cursor services.
 */

import { createCursor, arrayCursor, mapCursor, limitCursor, emptyCursor } from './table.js'

// ---------------------------------------------------------------------------
// Expression evaluation (row → value | boolean)
// ---------------------------------------------------------------------------

/** Three-valued logic helpers for SQL NULL */
const isNull = (v) => v === null || v === undefined

const createEval = (getExecute) => {
  const evalExpr = (expr, row, outer = null) => {
    if (expr == null) return null
    // bare string treated as field (should be normalized already)
    if (typeof expr === 'string') return row[expr]
    if (typeof expr !== 'object' || !expr.op) return expr

    const { op, args = [] } = expr

    switch (op) {
      case 'lit':
        return args[0]
      case 'field': {
        const name = args[0]
        if (row && Object.prototype.hasOwnProperty.call(row, name)) return row[name]
        if (row && name in row) return row[name]
        if (outer && Object.prototype.hasOwnProperty.call(outer, name)) return outer[name]
        if (outer && name in outer) return outer[name]
        // last segment of qualified name on outer/row
        if (name.includes('.')) {
          const short = name.split('.').pop()
          if (row && short in row) return row[short]
          if (outer && short in outer) return outer[short]
        }
        return null
      }

      case 'eq':  return cmp(evalExpr(args[0], row, outer), evalExpr(args[1], row, outer), (a, b) => a === b)
      case 'ne':  return cmp(evalExpr(args[0], row, outer), evalExpr(args[1], row, outer), (a, b) => a !== b)
      case 'gt':  return cmp(evalExpr(args[0], row, outer), evalExpr(args[1], row, outer), (a, b) => a > b)
      case 'gte': return cmp(evalExpr(args[0], row, outer), evalExpr(args[1], row, outer), (a, b) => a >= b)
      case 'lt':  return cmp(evalExpr(args[0], row, outer), evalExpr(args[1], row, outer), (a, b) => a < b)
      case 'lte': return cmp(evalExpr(args[0], row, outer), evalExpr(args[1], row, outer), (a, b) => a <= b)

      case 'and': {
        let hasNull = false
        for (const a of args) {
          const v = evalExpr(a, row, outer)
          if (v === false) return false
          if (isNull(v)) hasNull = true
        }
        return hasNull ? null : true
      }
      case 'or': {
        let hasNull = false
        for (const a of args) {
          const v = evalExpr(a, row, outer)
          if (v === true) return true
          if (isNull(v)) hasNull = true
        }
        return hasNull ? null : false
      }
      case 'not': {
        const v = evalExpr(args[0], row, outer)
        if (isNull(v)) return null
        return !v
      }

      case 'is_null':     return isNull(evalExpr(args[0], row, outer))
      case 'is_not_null': return !isNull(evalExpr(args[0], row, outer))

      case 'between': {
        const v = evalExpr(args[0], row, outer)
        const lo = evalExpr(args[1], row, outer)
        const hi = evalExpr(args[2], row, outer)
        if (isNull(v) || isNull(lo) || isNull(hi)) return null
        return v >= lo && v <= hi
      }

      case 'in': {
        const v = evalExpr(args[0], row, outer)
        if (isNull(v)) return null
        const list = args[1]
        let values
        if (Array.isArray(list)) values = list
        else if (list?.op === 'lit') values = list.args[0]
        else if (list && typeof list.op === 'string') {
          const bound = outer ? { ...outer, ...row } : { ...row }
          const rows = getExecute()(list, bound).collect()
          values = rows.map((r) => Object.values(r)[0])
        } else values = null
        if (!Array.isArray(values)) return false
        return values.some((x) => x === v)
      }

      case 'exists': {
        const rel = args[0]
        if (!rel || typeof rel.op !== 'string') return false
        const bound = outer ? { ...outer, ...row } : { ...row }
        const cur = getExecute()(rel, bound)
        return cur.next() != null
      }

      case 'like': {
        const v = evalExpr(args[0], row, outer)
        const pat = evalExpr(args[1], row, outer)
        if (isNull(v) || isNull(pat)) return null
        let re = ''
        for (const ch of String(pat)) {
          if (ch === '%') re += '.*'
          else if (ch === '_') re += '.'
          else if ('.*+?^${}()|[]\\'.includes(ch)) re += '\\' + ch
          else re += ch
        }
        return new RegExp('^' + re + '$', 'i').test(String(v))
      }

      case 'case': {
        // args: when, then, when, then, ..., else
        const a = args
        for (let i = 0; i + 1 < a.length - 1; i += 2) {
          if (evalExpr(a[i], row, outer) === true) return evalExpr(a[i + 1], row, outer)
        }
        return evalExpr(a[a.length - 1], row, outer)
      }

      case 'add': return numOp(evalExpr(args[0], row, outer), evalExpr(args[1], row, outer), (a, b) => a + b)
      case 'sub': return numOp(evalExpr(args[0], row, outer), evalExpr(args[1], row, outer), (a, b) => a - b)
      case 'mul': return numOp(evalExpr(args[0], row, outer), evalExpr(args[1], row, outer), (a, b) => a * b)
      case 'div': return numOp(evalExpr(args[0], row, outer), evalExpr(args[1], row, outer), (a, b) => b === 0 ? null : a / b)

      case 'upper': {
        const v = evalExpr(args[0], row, outer)
        return isNull(v) ? null : String(v).toUpperCase()
      }
      case 'lower': {
        const v = evalExpr(args[0], row, outer)
        return isNull(v) ? null : String(v).toLowerCase()
      }
      case 'length': {
        const v = evalExpr(args[0], row, outer)
        return isNull(v) ? null : String(v).length
      }
      case 'abs': {
        const v = evalExpr(args[0], row, outer)
        return isNull(v) ? null : Math.abs(Number(v))
      }
      case 'coalesce': {
        for (const a of args) {
          const v = evalExpr(a, row, outer)
          if (!isNull(v)) return v
        }
        return null
      }

      case 'alias':
        return evalExpr(args[0], row, outer)

      default:
        throw new Error(`unknown expr op: ${op}`)
    }
  }

  // comparison with NULL → unknown (null)
  const cmp = (a, b, fn) => {
    if (isNull(a) || isNull(b)) return null
    return fn(a, b)
  }

  const numOp = (a, b, fn) => {
    if (isNull(a) || isNull(b)) return null
    return fn(Number(a), Number(b))
  }

  /** Predicate used in filter: true only when expr evaluates to true (not null/false) */
  const matches = (expr, row, outer = null) => evalExpr(expr, row, outer) === true

  return { evalExpr, matches }
}

// ---------------------------------------------------------------------------
// createExecutor(catalog) — closes over catalog + eval
// ---------------------------------------------------------------------------

export const createExecutor = (catalog) => {
  let executeRef = null
  const { evalExpr, matches } = createEval(() => executeRef)

  /**
   * execute(node) → Cursor
   * Pure tree walk. Every data access goes through Table services.
   */
  const execute = (node, outerRow = null) => {
    if (!node || typeof node.op !== 'string') {
      throw new Error(`invalid plan node: ${JSON.stringify(node)}`)
    }

    switch (node.op) {
      // ----- source → Table.scan / capabilities -----
      case 'source': {
        const table = catalog.resolve(node.name)
        const cur = table.scan()
        if (!node.as) return cur
        const prefix = node.as + '.'
        return mapCursor(cur, (row) => {
          const out = { ...row }
          for (const [k, v] of Object.entries(row)) out[prefix + k] = v
          return out
        })
      }

      // ----- filter -----
      case 'filter': {
        const input = execute(node.in, outerRow)
        const pred = node.args[0]
        return mapCursor(input, (row) => (matches(pred, row, outerRow) ? row : null))
      }

      // ----- project -----
      case 'project': {
        const input = execute(node.in, outerRow)
        const cols = node.args || []
        return mapCursor(input, (row) => {
          const out = {}
          for (const col of cols) {
            if (col.op === 'field') {
              const n = col.args[0]
              out[n] = n in row ? row[n] : evalExpr(col, row, outerRow)
            } else if (col.op === 'alias') {
              const alias = col.args[1]
              out[alias] = evalExpr(col.args[0], row, outerRow)
            } else {
              const key = col.as || col.op || '_expr'
              out[key] = evalExpr(col, row, outerRow)
            }
          }
          return out
        })
      }

      // ----- sort (materializes — required for global order) -----
      case 'sort': {
        const rows = execute(node.in, outerRow).collect()
        const keys = node.args || []
        rows.sort((a, b) => {
          for (const k of keys) {
            const av = evalExpr(k.expr, a)
            const bv = evalExpr(k.expr, b)
            // NULLS FIRST (SQLite default for ASC)
            if (isNull(av) && isNull(bv)) continue
            if (isNull(av)) return k.dir === 'desc' ? 1 : -1
            if (isNull(bv)) return k.dir === 'desc' ? -1 : 1
            if (av < bv) return k.dir === 'desc' ? 1 : -1
            if (av > bv) return k.dir === 'desc' ? -1 : 1
          }
          return 0
        })
        return arrayCursor(rows)
      }

      // ----- limit / offset -----
      case 'limit': {
        const n = node.args[0]
        // if child is offset, fold
        if (node.in?.op === 'offset') {
          return limitCursor(execute(node.in.in, outerRow), n, node.in.args[0])
        }
        return limitCursor(execute(node.in, outerRow), n, 0)
      }
      case 'offset': {
        return limitCursor(execute(node.in, outerRow), Infinity, node.args[0])
      }

      // ----- distinct -----
      case 'distinct': {
        const rows = execute(node.in, outerRow).collect()
        const cols = node.args // optional field list
        const seen = new Set()
        const out = []
        for (const r of rows) {
          const key = cols
            ? JSON.stringify(cols.map((c) => r[c.args ? c.args[0] : c]))
            : JSON.stringify(r)
          if (!seen.has(key)) {
            seen.add(key)
            out.push(r)
          }
        }
        return arrayCursor(out)
      }

      // ----- join (nested loop baseline) -----
      case 'join': {
        const [leftNode, rightNode] = node.in
        const spec = node.args[0] || { type: 'inner' }
        const leftRows = execute(leftNode, outerRow).collect()
        const rightRows = execute(rightNode, outerRow).collect()
        const out = []
        const type = spec.type || 'inner'

        if (type === 'cross' || !spec.on) {
          for (const l of leftRows) {
            for (const r of rightRows) {
              out.push({ ...l, ...r })
            }
          }
        } else if (type === 'inner') {
          for (const l of leftRows) {
            for (const r of rightRows) {
              const merged = { ...l, ...r }
              if (matches(spec.on, merged)) out.push(merged)
            }
          }
        } else if (type === 'left') {
          for (const l of leftRows) {
            let matched = false
            for (const r of rightRows) {
              const merged = { ...l, ...r }
              if (matches(spec.on, merged)) {
                out.push(merged)
                matched = true
              }
            }
            if (!matched) out.push({ ...l }) // right side nulls omitted for simplicity
          }
        } else {
          throw new Error(`unsupported join type: ${type}`)
        }
        return arrayCursor(out)
      }

      // ----- group + aggregate (materialize) -----
      case 'group': {
        // group alone just partitions; usually followed by aggregate in plan
        // for baseline, materialize groups as { _key, _rows }
        const rows = execute(node.in, outerRow).collect()
        const keys = node.args || []
        const map = new Map()
        for (const r of rows) {
          const key = JSON.stringify(keys.map((k) => evalExpr(k, r)))
          if (!map.has(key)) map.set(key, [])
          map.get(key).push(r)
        }
        const out = []
        for (const [k, groupRows] of map) {
          const keyVals = JSON.parse(k)
          const row = { _rows: groupRows }
          keys.forEach((keyExpr, i) => {
            const name = keyExpr.op === 'field' ? keyExpr.args[0] : `_k${i}`
            row[name] = keyVals[i]
          })
          out.push(row)
        }
        return arrayCursor(out)
      }

      case 'aggregate': {
        // expects input to be either raw rows or already grouped (_rows)
        const rows = execute(node.in, outerRow).collect()
        const aggs = node.args || []

        // if no group upstream, aggregate whole set
        const groups = rows.length && rows[0]._rows
          ? rows
          : [{ _rows: rows }]

        const out = []
        for (const g of groups) {
          const base = { ...g }
          delete base._rows
          for (const a of aggs) {
            const name = a.as || a.fn
            let vals
            if (a.star || (a.expr && a.expr.op === 'star')) {
              vals = [] // signal COUNT(*)
            } else if (a.expr) {
              vals = g._rows.map((r) => evalExpr(a.expr, r))
            } else {
              vals = []
            }
            const aggVal = applyAgg(a.fn, vals, g._rows)
            base[name] = aggVal
            if (name !== a.fn) base[a.fn] = aggVal
          }
          out.push(base)
        }
        return arrayCursor(out)
      }

      case 'union': {
        const [left, right] = node.in
        const all = !!(node.args && node.args[0] && node.args[0].all)
        const a = execute(left, outerRow).collect()
        const b = execute(right, outerRow).collect()
        if (all) return arrayCursor(a.concat(b))
        const seen = new Set()
        const out = []
        for (const r of a.concat(b)) {
          const k = JSON.stringify(r)
          if (!seen.has(k)) { seen.add(k); out.push(r) }
        }
        return arrayCursor(out)
      }

      case 'with': {
        const ctes = node.args || []
        const saved = new Map()
        for (const cte of ctes) {
          const rows = execute(cte.rel, outerRow).collect()
          const t = {
            schema: { fields: {}, pk: null, indexed: [] },
            capabilities: { scan: true },
            scan: () => arrayCursor(rows.map((r) => ({ ...r }))),
            count: () => rows.length,
            get: () => null,
            find: () => arrayCursor([]),
            range: () => arrayCursor([]),
          }
          saved.set(cte.name, catalog.tables.has(cte.name) ? catalog.tables.get(cte.name) : undefined)
          catalog.register(cte.name, t)
        }
        try {
          return execute(node.in, outerRow)
        } finally {
          for (const [name, prev] of saved) {
            if (prev === undefined) catalog.tables.delete(name)
            else catalog.register(name, prev)
          }
        }
      }

      case 'pk_lookup': {
        const table = catalog.resolve(node.name)
        const row = table.get(node.args[0])
        if (!row) return arrayCursor([])
        let r = row
        if (node.as) {
          const prefix = node.as + '.'
          r = { ...row }
          for (const [k, v] of Object.entries(row)) r[prefix + k] = v
        }
        return arrayCursor([r])
      }

      case 'idx_lookup': {
        const table = catalog.resolve(node.name)
        const [field, value] = node.args
        let cur = table.find(field, value)
        if (node.as) {
          const prefix = node.as + '.'
          const rows = cur.collect().map((row) => {
            const r = { ...row }
            for (const [k, v] of Object.entries(row)) r[prefix + k] = v
            return r
          })
          return arrayCursor(rows)
        }
        return cur
      }

      case 'insert': {
        const table = catalog.resolve(node.name)
        const rows = node.args[0] || []
        let n = 0
        for (const r of rows) {
          const obj = {}
          for (const [k, v] of Object.entries(r)) {
            obj[k] = v && v.op ? evalExpr(v, {}, outerRow) : v
          }
          table.insert(obj)
          n++
        }
        return arrayCursor([{ changes: n }])
      }

      case 'update': {
        const table = catalog.resolve(node.name)
        const [setMap, where] = node.args
        const pred = where
          ? (row) => matches(where, row, outerRow)
          : () => true
        const patch = {}
        for (const [k, v] of Object.entries(setMap || {})) {
          patch[k] = v && v.op ? evalExpr(v, {}, outerRow) : v
        }
        // update needs per-row eval for expressions — simple: constant patch
        const n = table.update(pred, patch)
        return arrayCursor([{ changes: n }])
      }

      case 'delete': {
        const table = catalog.resolve(node.name)
        const where = node.args[0]
        const pred = where
          ? (row) => matches(where, row, outerRow)
          : () => true
        const n = table.remove(pred)
        return arrayCursor([{ changes: n }])
      }

      default:
        throw new Error(`execute: unsupported op '${node.op}'`)
    }
  }

  const applyAgg = (fn, vals, rows) => {
    switch (fn) {
      case 'count':
        // COUNT(*) or count without expr → row count; else count non-null
        if (!vals.length || vals.every((v) => v === null || v === undefined || v === '*'))
          return rows.length
        return vals.filter((v) => v !== null && v !== undefined).length
      case 'sum': {
        let s = 0
        let any = false
        for (const v of vals) {
          if (v != null) { s += Number(v); any = true }
        }
        return any ? s : null
      }
      case 'avg': {
        let s = 0, n = 0
        for (const v of vals) {
          if (v != null) { s += Number(v); n++ }
        }
        return n ? s / n : null
      }
      case 'min': {
        let m = null
        for (const v of vals) {
          if (v == null) continue
          if (m == null || v < m) m = v
        }
        return m
      }
      case 'max': {
        let m = null
        for (const v of vals) {
          if (v == null) continue
          if (m == null || v > m) m = v
        }
        return m
      }
      default:
        throw new Error(`unknown aggregate: ${fn}`)
    }
  }

  executeRef = execute

  /** Convenience: execute + collect */
  const run = (node) => execute(node).collect()

  return { execute, run, evalExpr, matches }
}
