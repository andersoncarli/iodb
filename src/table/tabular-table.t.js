import { tabularTable } from './tabular-table.js'
import { TabularProjection } from '../tabular-projection.js'
import { isTable, capabilities } from './contract.js'
import { conform } from './conformance.js'
import { toArray } from './cursor.js'

function seed(dir, name, schema, rows, opts = {}) {
  const file = dir + '/' + name
  const t = TabularProjection(file, { schema, ...opts })
  for (const r of rows) t.push(r)
  t.flush()
  return file
}

const rows = [
  { id: 1, name: 'Ana', age: 26 },
  { id: 2, name: 'Bob', age: 31 },
  { id: 3, name: 'Cid', age: 19 },
  { id: 4, name: 'Dan', age: 45 },
  { id: 5, name: 'Eva', age: 26 }
]

test('tabular-table: com pk e coluna indexada, tem get+find+range+count (nivel 4 -- count() sempre presente, O(indice))', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const file = seed(dir, 'l3.csv', 'id:int!,name:str@,age:int', rows)
    const t = tabularTable(file)
    check(isTable(t), true)
    const caps = capabilities(t)
    check(caps.level, 4)
    check(caps.has, { get: true, find: true, range: true, count: true, filter: false, group: false })
  })
})

test('tabular-table: sem nenhuma coluna indexada, e nivel 0 + count', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const file = seed(dir, 'l0.csv', 'id:int,name:str,age:int', rows)
    const t = tabularTable(file)
    const caps = capabilities(t)
    check(caps.level, 0)
    check(caps.has.get, false)
    check(caps.has.find, false)
    check(caps.has.count, true)
  })
})

test('tabular-table: scan() cede as mesmas linhas que foram escritas', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const file = seed(dir, 'scan.csv', 'id:int!,name:str@,age:int', rows)
    const t = tabularTable(file)
    const seen = toArray(t.scan())
    check(seen.length, 5)
    check(seen.map(r => r.name).sort(), ['Ana', 'Bob', 'Cid', 'Dan', 'Eva'])
  })
})

test('tabular-table: get(pk) por coluna indexada bate com scan|>filter|>first', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const file = seed(dir, 'get.csv', 'id:int!,name:str@,age:int', rows)
    const t = tabularTable(file)
    check(t.get(3), { id: 3, name: 'Cid', age: 19 })
    check(t.get(999), null)
  })
})

test('tabular-table: find() por coluna indexada devolve o conjunto certo', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const file = seed(dir, 'find.csv', 'id:int!,name:str@,age:int@', rows)
    const t = tabularTable(file)
    const found = toArray(t.find('age', 26))
    check(found.map(r => r.id).sort(), [1, 5])
  })
})

test('tabular-table: range() por coluna indexada mantem o descarte de pagina (le menos paginas que all())', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const big = []
    for (let i = 0; i < 500; i++) big.push({ id: i, name: 'n' + i, age: i % 100 })
    const file = seed(dir, 'range.csv', 'id:int!,name:str,age:int@', big, { pageSize: 256 })
    const proj = TabularProjection(file, { pageSize: 256 })
    proj.all()
    const totalPages = proj.pagesRead
    const got = proj.range('age', 0, 0)
    const rangePages = proj.pagesRead
    check(got.length, 5)
    check(rangePages < totalPages, true)

    const t = tabularTable(file, { pageSize: 256 })
    const viaTable = toArray(t.range('age', { gte: 0, lte: 0 }))
    check(viaTable.length, 5)
  })
})

test('tabular-table: count() e O(paginas do indice), nao abre pagina nenhuma', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const file = seed(dir, 'count.csv', 'id:int!,name:str@,age:int', rows)
    const t = tabularTable(file)
    check(t.count(), 5)
  })
})

test('tabular-table: conform() passa inteira contra a projecao tabular (nivel 3)', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const file = seed(dir, 'conform.csv', 'id:int!,name:str@,age:int@', rows)
    const ok = conform(() => tabularTable(file), rows, { pk: 'id' })
    check(ok, true)
  })
})

test('tabular-table: conform() passa contra a projecao sem indice (nivel 0)', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const file = seed(dir, 'conform0.csv', 'id:int,name:str,age:int', rows)
    const ok = conform(() => tabularTable(file), rows, { pk: 'id' })
    check(ok, true)
  })
})

test('tabular-table: limit(10) sobre scan() de arquivo grande le O(1) paginas', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const big = []
    for (let i = 0; i < 3000; i++) big.push({ id: i, name: 'n' + i, age: i % 50 })
    const file = seed(dir, 'biglimit.csv', 'id:int!,name:str,age:int', big, { pageSize: 512 })
    const t = tabularTable(file, { pageSize: 512 })
    const c = t.scan()
    let n = 0
    let v
    while (n < 10 && (v = c.next()) !== null) n++
    c.close()
    check(n, 10)
  })
})
