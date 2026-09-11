import { createEngine, createTable } from './engine.js'

const engine = createEngine()

engine.register('users', createTable({
  schema: {
    'id number pk': 0,
    'name string': '',
    'status string': '',
    'age number': 0,
  },
  rows: [
    { id: 1, name: 'Alice', status: 'active', age: 30 },
    { id: 2, name: 'Bob', status: 'active', age: 17 },
    { id: 3, name: 'Carol', status: 'inactive', age: 25 },
    { id: 4, name: 'Dave', status: 'active', age: 40 },
  ],
}))

const sql = `
  SELECT id, name
  FROM users
  WHERE status = 'active' AND age >= 18
  ORDER BY name
  LIMIT 20
`

console.log('=== Plan from SQL ===')
const plan = engine.parse(sql)
console.log(JSON.stringify(plan, null, 2))

console.log('\n=== exec(sql) ===')
console.log(engine.exec(sql))

console.log('\n=== more queries ===')
console.log('age between:', engine.exec(`SELECT name, age FROM users WHERE age BETWEEN 18 AND 35 ORDER BY age`))
console.log('IS NULL:', engine.exec(`SELECT name FROM users WHERE status IS NOT NULL`))
console.log('IN:', engine.exec(`SELECT name FROM users WHERE id IN (1, 4)`))
console.log('func:', engine.exec(`SELECT UPPER(name) AS n FROM users WHERE id = 1`))
