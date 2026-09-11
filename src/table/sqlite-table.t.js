import { SqliteCollection } from '../adapters/sqlite.js'
import { sqliteTable } from './sqlite-table.js'
import { isTable, capabilities } from './contract.js'
import { conform } from './conformance.js'
import { toArray, filterCursor } from './cursor.js'

function seed() {
  const col = SqliteCollection(':memory:', { table: 'users' })
  col.open()
  col.run('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
  col.run('CREATE INDEX idx_name ON users(name)')
  col.run("INSERT INTO users VALUES ('a','Ana',26),('b','Bob',31),('c','Cid',19),('d',NULL,45)")
  return col
}

test('sqlite-table: schema vem dos PRAGMAs -- pk e indexed refletidos, nivel 5 com pk+indexed', ({ check }) => {
  const col = seed()
  const t = sqliteTable(col, 'users')
  check(isTable(t), true)
  check(t.schema.fields.id.pk, true)
  check(t.schema.fields.name.indexed, true)
  check(t.schema.fields.name.nullable, true)
  check(t.schema.fields.age.indexed, 'undefined')
  const caps = capabilities(t)
  check(caps.has, { get: true, find: true, range: true, count: true, filter: true, group: true })
  check(caps.level, 5)
})

test('sqlite-table: tabela sem indice nenhum e L1 (so get+count)', ({ check }) => {
  const col = SqliteCollection(':memory:', { table: 'plain' })
  col.open()
  col.run('CREATE TABLE plain (id TEXT PRIMARY KEY, x INTEGER)')
  col.run("INSERT INTO plain VALUES ('a',1)")
  const t = sqliteTable(col, 'plain')
  const caps = capabilities(t)
  check(caps.has.get, true)
  check(caps.has.find, false)
  check(caps.has.range, false)
  check(caps.level, 1)
})

test('sqlite-table: scan() usa cursor real (iterate), rowsFetched conta so o que foi buscado', ({ check }) => {
  const col = SqliteCollection(':memory:', { table: 'big' })
  col.open()
  col.run('CREATE TABLE big (id INTEGER PRIMARY KEY, n INTEGER)')
  const rows = []
  for (let i = 0; i < 2000; i++) rows.push(`(${i},${i})`)
  col.run(`INSERT INTO big VALUES ${rows.join(',')}`)
  const t = sqliteTable(col, 'big')
  const c = t.scan()
  for (let i = 0; i < 10; i++) c.next()
  check(c.rowsFetched, 10)
  check(c.rowsFetched < 2000, true)
  c.close()
})

test('sqlite-table: get(pk) bate com scan|>filter|>first', ({ check }) => {
  const col = seed()
  const t = sqliteTable(col, 'users')
  check(t.get('b'), { id: 'b', name: 'Bob', age: 31 })
  check(t.get('zzz'), null)
})

test('sqlite-table: find() por coluna indexada devolve o conjunto certo', ({ check }) => {
  const col = seed()
  const t = sqliteTable(col, 'users')
  const found = toArray(t.find('name', 'Bob'))
  check(found, [{ id: 'b', name: 'Bob', age: 31 }])
})

test('sqlite-table: range() por coluna nao indexada ainda funciona (so nao pula pagina)', ({ check }) => {
  const col = seed()
  const t = sqliteTable(col, 'users')
  const got = toArray(t.range('age', { gte: 20, lte: 40 })).map(r => r.id).sort()
  check(got, ['a', 'b'])
})

test('sqlite-table: count() bate com a contagem real', ({ check }) => {
  const col = seed()
  const t = sqliteTable(col, 'users')
  check(t.count(), 4)
})

test('sqlite-table: ARMADILHA NULL -- find(name, null) usa IS NULL, bate com scan|>filter(r.name===null)', ({ check }) => {
  const col = seed()
  const t = sqliteTable(col, 'users')
  const viaFind = toArray(t.find('name', null))
  const viaScanFilter = toArray(filterCursor(t.scan(), r => r.name === null))
  check(viaFind.map(r => r.id), viaScanFilter.map(r => r.id))
  check(viaFind.map(r => r.id), ['d'])
})

test('sqlite-table: ARMADILHA COLACAO -- find(name, "ana") e case-sensitive, igual ao === de JS', ({ check }) => {
  const col = seed()
  const t = sqliteTable(col, 'users')
  const viaFind = toArray(t.find('name', 'ana'))
  const viaScanFilter = toArray(filterCursor(t.scan(), r => r.name === 'ana'))
  check(viaFind.length, 0)
  check(viaScanFilter.length, 0)
})

test('sqlite-table: ARMADILHA COERCAO -- filter(age eq 0) nao casa string vazia nem false, igual ao === de JS', ({ check }) => {
  const col = SqliteCollection(':memory:', { table: 'coerce' })
  col.open()
  col.run('CREATE TABLE coerce (id TEXT PRIMARY KEY, n INTEGER)')
  col.run("INSERT INTO coerce VALUES ('a',0),('b',1)")
  const t = sqliteTable(col, 'coerce')
  const viaFilter = toArray(t.filter({ op: 'eq', field: 'n', value: 0 }))
  const viaScanFilter = toArray(filterCursor(t.scan(), r => r.n === 0))
  check(viaFilter.map(r => r.id), ['a'])
  check(viaFilter.map(r => r.id), viaScanFilter.map(r => r.id))
})

test('sqlite-table: filter() traduz eq/comparacoes/and/or e bate com scan|>filter', ({ check }) => {
  const col = seed()
  const t = sqliteTable(col, 'users')
  const expr = { op: 'and', args: [{ op: 'gte', field: 'age', value: 20 }, { op: 'lt', field: 'age', value: 30 }] }
  const viaFilter = toArray(t.filter(expr)).map(r => r.id).sort()
  const viaScan = toArray(filterCursor(t.scan(), r => r.age >= 20 && r.age < 30)).map(r => r.id).sort()
  check(viaFilter, viaScan)
  check(viaFilter, ['a'])
})

test('sqlite-table: filter() com predicado nao traduzivel devolve null (fallback e responsabilidade do chamador)', ({ check }) => {
  const col = seed()
  const t = sqliteTable(col, 'users')
  check(t.filter({ op: 'regex', field: 'name', value: '^A' }), null)
  check(t.filter({ op: 'eq', field: 'nao_existe', value: 1 }), null)
})

test('sqlite-table: group() agrupa e conta', ({ check }) => {
  const col = SqliteCollection(':memory:', { table: 'g' })
  col.open()
  col.run('CREATE TABLE g (id TEXT PRIMARY KEY, cat TEXT)')
  col.run("INSERT INTO g VALUES ('a','x'),('b','x'),('c','y')")
  const t = sqliteTable(col, 'g')
  const groups = toArray(t.group('cat')).sort((a, b) => a._group.localeCompare(b._group))
  check(groups, [{ _group: 'x', _count: 2 }, { _group: 'y', _count: 1 }])
})

test('sqlite-table: conform() passa inteira contra a tabela com pk+indexed (nivel 5)', ({ check }) => {
  const col = seed()
  const expectedRows = toArray(sqliteTable(col, 'users').scan())
  const ok = conform(() => sqliteTable(col, 'users'), expectedRows, { pk: 'id' })
  check(ok, true)
})
