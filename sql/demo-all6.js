/**
 * Regression across the 6 points.
 */
import { createEngine } from './engine.js'

const engine = createEngine()

const ok = (label, cond) => {
  console.log(cond ? '✓' : '✗', label)
  if (!cond) throw new Error('FAIL: ' + label)
}

// 4 CREATE + 3 INSERT
engine.exec(`CREATE TABLE users (id integer PRIMARY KEY, name text, status text)`)
engine.exec(`CREATE TABLE orders (id integer PRIMARY KEY, user_id integer, amount integer)`)
engine.exec(`INSERT INTO users (id, name, status) VALUES (1, 'Alice', 'active'), (2, 'Bob', 'active'), (3, 'Carol', 'inactive')`)
engine.exec(`INSERT INTO orders (id, user_id, amount) VALUES (10, 1, 100), (11, 1, 50), (12, 2, 80)`)

// 1 correlation
let r = engine.exec(`SELECT name FROM users u WHERE EXISTS (SELECT id FROM orders WHERE user_id = u.id)`)
ok('1 correlated EXISTS', r.length === 2 && r[0].name === 'Alice')

// 2 NOT *
r = engine.exec(`SELECT name FROM users WHERE id NOT IN (1, 2)`)
ok('2 NOT IN', r.length === 1 && r[0].name === 'Carol')
r = engine.exec(`SELECT name FROM users WHERE name NOT LIKE 'A%'`)
ok('2 NOT LIKE', r.some((x) => x.name === 'Bob'))

// 3 UPDATE DELETE
engine.exec(`UPDATE users SET status = 'vip' WHERE id = 1`)
r = engine.exec(`SELECT status FROM users WHERE id = 1`)
ok('3 UPDATE', r[0].status === 'vip')
engine.exec(`DELETE FROM orders WHERE id = 11`)
r = engine.exec(`SELECT COUNT(*) AS n FROM orders`)
ok('3 DELETE', r[0].n === 2)

// 5 optimize
const opt = engine.optimize(engine.parse(`SELECT name FROM users WHERE id = 2`))
ok('5 pk_lookup under project', opt.op === 'project' && opt.in?.op === 'pk_lookup')
r = engine.execPlan(opt)
ok('5 pk_lookup result', r[0].name === 'Bob')

// idx_lookup
engine.register('t', engine.createTable({
  name: 't',
  schema: { 'id number pk': 0, 'status string indexed': '' },
  rows: [{ id: 1, status: 'x' }, { id: 2, status: 'y' }],
}))
const opt2 = engine.optimize(engine.parse(`SELECT id FROM t WHERE status = 'y'`))
ok('5 idx_lookup', opt2.in?.op === 'idx_lookup' || opt2.op === 'idx_lookup')

console.log('\nAll checks passed.')
