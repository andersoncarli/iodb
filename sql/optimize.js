/**
 * Pre-execution optimization: rewrite IR using Table capabilities.
 * Pure: node in → node out. Never executes.
 *
 * Rules (baseline):
 *   filter(eq(pk, lit)) + source  →  still filter+source for now,
 *   but annotate / replace with capability hints when safe.
 *
 *   For equality on pk: we can replace filter+source with a special
 *   get_scan node, or leave logical and let execute use get.
 *
 * This pass implements:
 *   1. filter(eq(field, lit), source) when field is pk → { op:'pk_lookup', name, key }
 *   2. filter(eq(field, lit), source) when field indexed → { op:'idx_lookup', name, field, key }
 * execute must handle pk_lookup / idx_lookup (or we expand back).
 */

export const createOptimize = (catalog) => {
  const isEqLit = (expr) => {
    if (!expr || expr.op !== 'eq') return null
    const [a, b] = expr.args || []
    const field = a?.op === 'field' ? a.args[0] : null
    const lit = b?.op === 'lit' ? b.args[0] : (a?.op === 'lit' ? a.args[0] : null)
    const field2 = b?.op === 'field' ? b.args[0] : field
    if (a?.op === 'field' && b?.op === 'lit') return { field: a.args[0], value: b.args[0] }
    if (b?.op === 'field' && a?.op === 'lit') return { field: b.args[0], value: a.args[0] }
    return null
  }

  const optimize = (node) => {
    if (!node || typeof node !== 'object') return node

    // recurse children first
    let n = node
    if (n.in) {
      if (Array.isArray(n.in)) {
        n = { ...n, in: n.in.map(optimize) }
      } else {
        n = { ...n, in: optimize(n.in) }
      }
    }
    if (Array.isArray(n.args)) {
      n = {
        ...n,
        args: n.args.map((a) =>
          a && typeof a === 'object' && a.op ? optimize(a) : a
        ),
      }
    }

    // filter + source capability rewrite
    if (n.op === 'filter' && n.in?.op === 'source') {
      const eq = isEqLit(n.args?.[0])
      if (eq) {
        try {
          const table = catalog.resolve(n.in.name)
          const schema = table.schema || {}
          if (schema.pk === eq.field) {
            return {
              op: 'pk_lookup',
              name: n.in.name,
              as: n.in.as,
              args: [eq.value],
            }
          }
          if (schema.indexed && schema.indexed.includes(eq.field)) {
            return {
              op: 'idx_lookup',
              name: n.in.name,
              as: n.in.as,
              args: [eq.field, eq.value],
            }
          }
        } catch {
          /* table may not exist yet at optimize time for CTEs */
        }
      }
    }

    return n
  }

  return { optimize }
}
