import { createEngine, createTable } from './engine.js'

const engine = createEngine()

engine.register('users', createTable({
  schema: {
    'id number pk': 0,
    'name string': '',
    'status string': '',
  },
  rows: [
    { id: 1, name: 'Alice', status: 'active' },
    { id: 2, name: 'Bob', status: 'active' },
    { id: 3, name: 'Carol', status: 'inactive' },
  ],
}))

engine.register('orders', createTable({
  schema: {
    'id number pk': 0,
    'user_id number': 0,
    'amount number': 0,
  },
  rows: [
    { id: 10, user_id: 1, amount: 100 },
    { id: 11, user_id: 1, amount: 50 },
    { id: 12, user_id: 2, amount: 80 },
    { id: 13, user_id: 99, amount: 5 },
  ],
}))

const run = (label, sql) => {
  console.log('\n===', label, '===')
  console.log(sql.trim())
  try {
    console.log(engine.exec(sql))
  } catch (e) {
    console.error('ERR', e.message)
  }
}

run('JOIN', `
  SELECT u.name, o.amount
  FROM users u
  JOIN orders o ON u.id = o.user_id
  ORDER BY u.name, o.amount
`)

run('LEFT JOIN', `
  SELECT u.name, o.amount
  FROM users u
  LEFT JOIN orders o ON u.id = o.user_id
  ORDER BY u.name
`)

run('COUNT + GROUP BY', `
  SELECT user_id, COUNT(*) AS n, SUM(amount) AS total
  FROM orders
  GROUP BY user_id
  ORDER BY user_id
`)

run('HAVING', `
  SELECT user_id, COUNT(*) AS n
  FROM orders
  GROUP BY user_id
  HAVING COUNT(*) > 1
`)

run('global aggregate', `
  SELECT COUNT(*) AS n, SUM(amount) AS total FROM orders
`)
