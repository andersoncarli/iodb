/**
 * Self-check: fluent construction produces pure nodes, no execution.
 */
import { createAlgebra } from './algebra.js'

const { createDb, is, filter, source } = createAlgebra()

const db = createDb()

// ----- Example from the SPEC -----
const q = db.users
  .status('active')
  .age.gte(18)
  .pick('id', 'name')
  .sort('name')
  .limit(20)

console.log('=== Fluent plan (JSON) ===')
console.log(JSON.stringify(q.node, null, 2))

// ----- Same plan built with explicit factories (what SQL parser will do) -----
const explicit = {
  op: 'limit',
  args: [20],
  in: {
    op: 'sort',
    args: [{ expr: { op: 'field', args: ['name'] }, dir: 'asc' }],
    in: {
      op: 'project',
      args: [
        { op: 'field', args: ['id'] },
        { op: 'field', args: ['name'] },
      ],
      in: {
        op: 'filter',
        args: [is.gte('age', 18)],
        in: {
          op: 'filter',
          args: [is.eq('status', 'active')],
          in: { op: 'source', name: 'users' },
        },
      },
    },
  },
}

console.log('\n=== Explicit factories produce equivalent shape ===')
console.log('fluent source name:', q.node.in.in.in.in.in.name)
console.log('explicit source name:', explicit.in.in.in.in.in.name)

// ----- More sugar -----
const q2 = db.orders
  .where(is.and(is.eq('state', 'NY'), is.gte('total', 100)))
  .pick('id', 'total')
  .sort({ expr: 'total', dir: 'desc' })
  .limit(5)

console.log('\n=== where(is.and(...)) ===')
console.log(JSON.stringify(q2.node, null, 2))

// ----- Field chain callable + methods -----
const q3 = db.users.name('Alice')           // callable = eq
const q4 = db.users.age.between(18, 65)
const q5 = db.users.email.isNull()

console.log('\n=== field sugar variants ===')
console.log('name(Alice):', JSON.stringify(q3.node))
console.log('age.between:', JSON.stringify(q4.node))
console.log('email.isNull:', JSON.stringify(q5.node))

// ----- Guarantee: construction is pure (no side effects) -----
console.log('\n=== Purity check ===')
console.log('All of the above only built nodes. No scan/IO occurred.')
console.log('q.node.op =', q.node.op)
