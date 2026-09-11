// Probe da feature 8.6 — o sqlite vira Table, nivel 5, push-down no contrato.
import { SqliteCollection } from '../../src/adapters/sqlite.js'
import { sqliteTable } from '../../src/table/sqlite-table.js'
import { isTable, capabilities } from '../../src/table/contract.js'
import { conform } from '../../src/table/conformance.js'
import { toArray, filterCursor } from '../../src/table/cursor.js'

const col = SqliteCollection(':memory:', { table: 'users' })
col.open()
col.run('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
col.run('CREATE INDEX idx_name ON users(name)')
col.run("INSERT INTO users VALUES ('a','Ana',26),('b','Bob',31),('c','Cid',19),('d',NULL,45)")

const t = sqliteTable(col, 'users')
console.log('isTable:', isTable(t))
const caps = capabilities(t)
console.log('level:', caps.level)
console.log('has:', JSON.stringify(caps.has))

const rows = toArray(t.scan())
console.log('conform:', conform(() => sqliteTable(col, 'users'), rows, { pk: 'id' }))

// L1 (sem indice): find/range ausentes.
const colPlain = SqliteCollection(':memory:', { table: 'plain' })
colPlain.open()
colPlain.run('CREATE TABLE plain (id TEXT PRIMARY KEY, x INTEGER)')
colPlain.run("INSERT INTO plain VALUES ('a',1)")
const tPlain = sqliteTable(colPlain, 'plain')
console.log('plain-level:', capabilities(tPlain).level)
console.log('plain-has-find:', capabilities(tPlain).has.find)

// rowsFetched: cursor real, scan interrompido nao busca a tabela inteira.
const colBig = SqliteCollection(':memory:', { table: 'big' })
colBig.open()
colBig.run('CREATE TABLE big (id INTEGER PRIMARY KEY, n INTEGER)')
const bigRows = []
for (let i = 0; i < 100000; i++) bigRows.push(`(${i},${i})`)
colBig.run(`INSERT INTO big VALUES ${bigRows.join(',')}`)
const tBig = sqliteTable(colBig, 'big')
const c = tBig.scan()
for (let i = 0; i < 10; i++) c.next()
console.log('rowsFetched:', c.rowsFetched)
console.log('rowsFetched-is-order-10:', c.rowsFetched >= 10 && c.rowsFetched < 100)
c.close()

// Reentrancia: dois scans concorrentes sao independentes.
const a = t.scan()
const b = t.scan()
const interleaved = [a.next().id, b.next().id, a.next().id, b.next().id]
console.log('interleaved:', interleaved.join(','))

// Armadilha NULL.
const viaFind = toArray(t.find('name', null)).map(r => r.id)
const viaScan = toArray(filterCursor(t.scan(), r => r.name === null)).map(r => r.id)
console.log('null-trap-match:', JSON.stringify(viaFind) === JSON.stringify(viaScan))

// Armadilha colacao.
console.log('collation-case-sensitive:', toArray(t.find('name', 'ana')).length === 0)

// filter/group.
const filtered = toArray(t.filter({ op: 'and', args: [{ op: 'gte', field: 'age', value: 20 }, { op: 'lt', field: 'age', value: 30 }] }))
console.log('filter-result:', filtered.map(r => r.id).sort().join(','))
console.log('filter-untranslatable:', t.filter({ op: 'regex', field: 'name', value: '^A' }))
