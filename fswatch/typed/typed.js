// named, autoreferential type tree; serializers and languages share this scope
export function Typed() {
  const scope = { meta: {}, types: new Map(), constructors: new Map(), languages: new Map(), serializers: new Map() }
  const define = (name, expr) => (scope.types.set(name, expr), expr)
  const primitive = name => ({ name, base: name })
  const build = (expr, seen = new Set()) => {
    if (typeof expr != 'string') return expr
    if (!scope.types.has(expr)) return primitive(expr)
    if (seen.has(expr)) throw Error(`recursive type: ${expr}`)
    const next = new Set(seen).add(expr), value = scope.types.get(expr)
    if (typeof value != 'string') return value
    // Postfix form: `<base> <op>` — e.g. `pk = i autoinc`, `node-id-delta = node-id delta`.
    // A bare reference to another name (no operator) just recurses one level.
    const [base, op] = value.trim().split(/\s+/), ctor = op && scope.constructors.get(op)
    return ctor ? ctor(build(base, next)) : build(value, next)
  }
  const resolve = name => build(name)
  const schema = definition => Object.fromEntries(Object.entries(definition).map(([name, type]) => [name, { name, source: type, type: resolve(type) }]))
  const load = object => Object.entries(object || {}).forEach(([name, expr]) => define(name, expr))
  return { ...scope, define, resolve, schema, load }
}

export const builtins = scope => {
  scope.constructors.set('delta', base => ({ kind: 'delta', base }))
  scope.constructors.set('autoinc', base => ({ kind: 'autoinc', base }))
  return scope
}
