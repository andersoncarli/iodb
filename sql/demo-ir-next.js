/**
 * IR-first: build plans with factories only, then RUN.
 * SQL translation is secondary and must produce the same IR.
 */
import { createEngine, createTable } from './engine.js'

const engine = createEngine()
const { is, source, filter, project, sort, limit, join, group, aggregate, union, withCte, execPlan } = engine

engine.register('users', createTable({
  rows: [
    { id: 1, name: 'Alice', status: 'active' },
    { id: 2, name: 'Bob', status: 'active' },
    { id: 3, name: 'Carol', status: 'inactive' },
  ],
}))
engine.register('orders', createTable({
  rows: [
    { id: 10, user_id: 1, amount: 100 },
    { id: 11, user_id: 1, amount: 50 },
    { id: 12, user_id: 2, amount: 80 },
  ],
}))

const show = (label, plan) => {
  console.log('\n===', label, '===')
  console.log(JSON.stringify(plan, null, 2).slice(0, 200) + '...')
  console.log('→', execPlan(plan))
}

// IN subquery: users whose id appears in orders
const inSub = filter(
  source('users'),
  is.in('id', project(source('orders'), ['user_id']))
)
show('IN subquery (IR)', project(inSub, ['id', 'name']))

// EXISTS
const existsPlan = filter(
  source('users'),
  is.exists(
    filter(source('orders'), is.eq('user_id', is.field('id'))) // correlated not supported yet — use static
  )
)
// non-correlated EXISTS (orders non-empty)
const exists2 = filter(
  source('users'),
  is.exists(source('orders'))
)
show('EXISTS orders (IR)', project(exists2, ['name']))

// UNION
const u = union(
  project(filter(source('users'), is.eq('status', 'active')), ['name']),
  project(filter(source('users'), is.eq('name', 'Carol')), ['name'])
)
show('UNION (IR)', u)

// WITH
const w = withCte(
  [{ name: 'act', rel: filter(source('users'), is.eq('status', 'active')) }],
  project(source('act'), ['name'])
)
show('WITH (IR)', w)

// LIKE + CASE (expression only via filter/project)
const likePlan = project(
  filter(source('users'), is.like('name', 'A%')),
  [
    is.field('name'),
    { op: 'alias', args: [
      is.case(
        [{ when: is.eq('status', 'active'), then: is.lit('yes') }],
        is.lit('no')
      ),
      'active_flag',
    ] },
  ]
)
show('LIKE + CASE (IR)', likePlan)

// --- SQL must match ---
console.log('\n========== SQL translations ==========')
const sqls = [
  [`SELECT name FROM users WHERE id IN (SELECT user_id FROM orders)`, 'IN'],
  [`SELECT name FROM users WHERE EXISTS (SELECT id FROM orders)`, 'EXISTS'],
  [`SELECT name FROM users WHERE status = 'active' UNION SELECT name FROM users WHERE name = 'Carol'`, 'UNION'],
  [`WITH act AS (SELECT name, status FROM users WHERE status = 'active') SELECT name FROM act`, 'WITH'],
  [`SELECT name FROM users WHERE name LIKE 'A%'`, 'LIKE'],
  [`SELECT name, CASE WHEN status = 'active' THEN 'yes' ELSE 'no' END AS active_flag FROM users WHERE name LIKE 'A%'`, 'CASE'],
]
for (const [sql, label] of sqls) {
  console.log('\n---', label, '---')
  try {
    console.log(engine.exec(sql))
  } catch (e) {
    console.error('ERR', e.message)
  }
}
