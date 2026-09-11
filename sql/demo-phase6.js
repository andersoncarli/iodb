import { createEngine, createTable } from './engine.js'

const engine = createEngine()

console.log('=== 4. CREATE TABLE ===')
console.log(engine.exec(`CREATE TABLE users (id integer PRIMARY KEY, name text, status text)`))
console.log(engine.exec(`CREATE TABLE orders (id integer PRIMARY KEY, user_id integer, amount integer)`))

console.log('\n=== 3. INSERT ===')
console.log(engine.exec(`INSERT INTO users (id, name, status) VALUES (1, 'Alice', 'active'), (2, 'Bob', 'active'), (3, 'Carol', 'inactive')`))
console.log(engine.exec(`INSERT INTO orders (id, user_id, amount) VALUES (10, 1, 100), (11, 1, 50), (12, 2, 80)`))

console.log('\n=== SELECT baseline ===')
console.log(engine.exec(`SELECT name FROM users WHERE status = 'active'`))

console.log('\n=== 1. Correlated EXISTS ===')
console.log(engine.exec(`
  SELECT name FROM users u
  WHERE EXISTS (SELECT id FROM orders WHERE user_id = id)
`))
// Note: field id resolves from outer after orders row lookup fails

console.log('\n=== 2. NOT IN / NOT LIKE ===')
console.log(engine.exec(`SELECT name FROM users WHERE id NOT IN (1, 2)`))
console.log(engine.exec(`SELECT name FROM users WHERE name NOT LIKE 'A%'`))

console.log('\n=== 3. UPDATE / DELETE ===')
console.log(engine.exec(`UPDATE users SET status = 'vip' WHERE name = 'Alice'`))
console.log(engine.exec(`SELECT name, status FROM users WHERE name = 'Alice'`))
console.log(engine.exec(`DELETE FROM orders WHERE amount < 60`))
console.log(engine.exec(`SELECT id, amount FROM orders`))

console.log('\n=== 5. OPTIMIZE pk lookup ===')
const plan = engine.parse(`SELECT name FROM users WHERE id = 2`)
const opt = engine.optimize(plan)
console.log('optimized op:', opt.op, opt.args)
console.log(engine.execPlan(opt))
