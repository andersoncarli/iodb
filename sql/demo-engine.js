/**
 * End-to-end: algebra (nodes) + Table/Cursor services + execute
 * Engine only navigates the tree; all data access via Table.
 */
import { createEngine, createTable } from './engine.js'

const engine = createEngine()

// ----- physical tables (services) -----
engine.register('users', createTable({
  schema: {
    'id number pk autoinc': 0,
    'name string indexed': '',
    'status string indexed': '',
    'age number indexed': 0,
  },
  rows: [
    { id: 1, name: 'Alice', status: 'active', age: 30 },
    { id: 2, name: 'Bob',   status: 'active', age: 17 },
    { id: 3, name: 'Carol', status: 'inactive', age: 25 },
    { id: 4, name: 'Dave',  status: 'active', age: 40 },
  ],
}))

// ----- fluent construction (pure) then run -----
const q = engine.db.users
  .status('active')
  .age.gte(18)
  .pick('id', 'name')
  .sort('name')
  .limit(20)

console.log('=== Plan node (no execution yet) ===')
console.log(JSON.stringify(q.node, null, 2))

console.log('\n=== Result after .run() ===')
console.log(q.run())

// ----- same plan via explicit factories (SQL parser target) -----
const { source, filter, project, sort, limit, is } = engine
const plan = limit(
  sort(
    project(
      filter(
        filter(source('users'), is.eq('status', 'active')),
        is.gte('age', 18)
      ),
      ['id', 'name']
    ),
    'name'
  ),
  20
)

console.log('\n=== Explicit factories → same result ===')
console.log(engine.execPlan(plan))

// ----- Table capabilities used directly (optimizer will call these later) -----
const users = engine.catalog.resolve('users')
console.log('\n=== Table.get(1) ===', users.get(1))
console.log('=== Table.find(status, active) count ===', users.find('status', 'active').collect().length)
console.log('=== Table.range(age, { gte: 18 }) ===', users.range('age', { gte: 18 }).collect().map(r => r.name))
console.log('=== Table.count() ===', users.count())

// ----- WHERE with is.and -----
const q2 = engine.db.users
  .where(is.and(is.eq('status', 'active'), is.lt('age', 35)))
  .pick('name', 'age')
  .sort('age')

console.log('\n=== is.and filter ===')
console.log(q2.run())
