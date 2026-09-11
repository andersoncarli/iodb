/**
 * Engine: SQL → IR → OPT → RUN
 */
import { createAlgebra } from './algebra.js'
import { createCatalog, createTable } from './table.js'
import { createExecutor } from './execute.js'
import { createParser } from './parser.js'
import { createOptimize } from './optimize.js'

export const createEngine = (options = {}) => {
  const catalog = options.catalog || createCatalog()
  const alg = createAlgebra()
  const { execute, run, evalExpr } = createExecutor(catalog)
  const { parse } = createParser(alg)
  const { optimize } = createOptimize(catalog)

  const normalize = (node) => node

  const execPlan = (node) => {
    const plan = optimize(normalize(node))
    // DDL
    if (plan.op === 'create_table') {
      const table = createTable({ name: plan.name, schema: plan.args[0] || {} })
      catalog.register(plan.name, table)
      return [{ name: plan.name, created: true }]
    }
    return run(plan)
  }

  const exec = (sql) => execPlan(parse(sql))

  const isFieldChain = (v) =>
    typeof v === 'function' && (typeof v.eq === 'function' || v.expr != null)

  const wrapFieldChain = (chainFn) => {
    const wrapped = (...args) => {
      const result = chainFn(...args)
      return result && result.node ? withRun(result) : result
    }
    for (const m of ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'isNull', 'isNotNull', 'between', 'in']) {
      if (typeof chainFn[m] === 'function') {
        wrapped[m] = (...a) => {
          const result = chainFn[m](...a)
          return result && result.node ? withRun(result) : result
        }
      }
    }
    wrapped.expr = chainFn.expr
    wrapped.field = chainFn.field
    return wrapped
  }

  const withRun = (q) => {
    const runFn = () => execPlan(q.node)
    return new Proxy(q, {
      get(target, prop, receiver) {
        if (prop === 'run' || prop === 'collect') return runFn
        if (prop === 'node') return target.node
        if (prop === 'then') return undefined
        const val = Reflect.get(target, prop, receiver)
        if (isFieldChain(val)) return wrapFieldChain(val)
        if (typeof val === 'function' && prop !== 'toJSON' && prop !== 'valueOf') {
          return (...args) => {
            const result = val.apply(target, args)
            if (result && result.node) return withRun(result)
            if (isFieldChain(result)) return wrapFieldChain(result)
            return result
          }
        }
        return val
      },
    })
  }

  const db = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined
      return withRun(alg.query(alg.source(String(prop))))
    },
  })

  const register = (name, tableOrOpts) => {
    const table = tableOrOpts && typeof tableOrOpts.scan === 'function'
      ? tableOrOpts
      : createTable({ ...tableOrOpts, name })
    catalog.register(name, table)
    return api
  }

  const api = {
    is: alg.is,
    source: alg.source,
    filter: alg.filter,
    project: alg.project,
    sort: alg.sort,
    limit: alg.limit,
    offset: alg.offset,
    distinct: alg.distinct,
    join: alg.join,
    group: alg.group,
    aggregate: alg.aggregate,
    withCte: alg.withCte,
    union: alg.union,
    insert: alg.insert,
    update: alg.update,
    remove: alg.remove,
    createTableStmt: alg.createTableStmt,
    query: alg.query,
    catalog,
    register,
    createTable,
    db,
    execPlan,
    exec,
    parse,
    execute,
    run,
    optimize,
    normalize,
    evalExpr,
  }

  return api
}

export { createTable, createCatalog, createAlgebra }
