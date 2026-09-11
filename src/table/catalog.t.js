import { catalog, catalogExecutor, resolveSource } from './catalog.js'
import { isTable, capabilities } from './contract.js'
import { conform } from './conformance.js'
import { toArray } from './cursor.js'
import { TabularProjection } from '../tabular-projection.js'
import { IO, merge } from '../io-engine.js'
const fsmod = require('fs')

function spyOnCalls(obj, method) {
  const original = obj[method]
  const calls = []
  obj[method] = (...args) => { calls.push(args); return original(...args) }
  return { calls, restore: () => { obj[method] = original } }
}

const rows = [
  { id: 1, name: 'Ana', age: 26 },
  { id: 2, name: 'Bob', age: 31 },
  { id: 3, name: 'Cid', age: 19 }
]

function seedCsv(dir, name) {
  const t = TabularProjection(`${dir}/${name}.csv`, { schema: 'id:int!,name:str@,age:int' })
  for (const r of rows) t.push(r)
  t.flush()
}

function seedDash(dir, name) {
  const io = IO(`${dir}/${name}`, { reduce: merge, initial: {} })
  io.open()
  for (const r of rows) io.in({ [r.id]: { name: r.name, age: r.age } })
}

test('catalog: db.users produz um no {op:source,name:users}, sem tocar o disco', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const spy = spyOnCalls(fsmod, 'existsSync')
    const db = catalog(dir)
    const node = db.users
    check(node, { op: 'source', name: 'users' })
    check(spy.calls.length, 0)
    spy.restore()
  })
})

test('catalog: db.foo (inexistente) tambem nao lanca e nao toca o disco', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const spy = spyOnCalls(fsmod, 'existsSync')
    const db = catalog(dir)
    let threw = false
    let node
    try { node = db.foo } catch { threw = true }
    check(threw, false)
    check(node, { op: 'source', name: 'foo' })
    check(spy.calls.length, 0)
    spy.restore()
  })
})

test('catalog: db.users === db.users (identidade estavel dentro da sessao)', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const db = catalog(dir)
    check(db.users === db.users, true)
  })
})

test('catalog: resolver o no de um users.csv devolve uma Table que passa conform()', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    seedCsv(dir, 'users')
    const db = catalog(dir)
    const t = resolveSource(db.users, { dir })
    check(isTable(t), true)
    const ok = conform(() => resolveSource(db.users, { dir }), rows.map(r => ({ id: r.id, name: r.name, age: r.age })), { pk: 'id' })
    check(ok, true)
  })
})

test('catalog: resolver o no de um users.dash devolve uma Table que passa conform()', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    seedDash(dir, 'users')
    const db = catalog(dir)
    const t = resolveSource(db.users, { dir })
    check(isTable(t), true)
    const expected = toArray(t.scan())
    const ok = conform(() => resolveSource(db.users, { dir }), expected, { pk: '_key' })
    check(ok, true)
  })
})

test('catalog: resolver um no para arquivo inexistente devolve null (nao lanca)', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const db = catalog(dir)
    const t = resolveSource(db.foo, { dir })
    check(t, null)
  })
})

test('catalog: CSV e .dash dos mesmos dados devolvem os mesmos conjuntos, com capabilities diferentes', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    seedCsv(dir, 'usersCsv')
    seedDash(dir, 'usersDash')
    const db = catalog(dir)
    const tCsv = resolveSource(db.usersCsv, { dir })
    const tDash = resolveSource(db.usersDash, { dir })

    const fromCsv = toArray(tCsv.scan()).map(r => ({ name: r.name, age: r.age })).sort((a, b) => a.name.localeCompare(b.name))
    const fromDash = toArray(tDash.scan()).map(r => ({ name: r.name, age: r.age })).sort((a, b) => a.name.localeCompare(b.name))
    check(fromCsv, fromDash)

    check(capabilities(tCsv).level, 4)
    check(capabilities(tDash).level, 1)
    check(capabilities(tCsv).has.find, true)
    check(capabilities(tDash).has.find, false)
  })
})

test('catalogExecutor: resolve() cacheia o resultado -- resolver duas vezes nao reabre o arquivo', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    seedCsv(dir, 'users')
    const db = catalog(dir)
    const exec = catalogExecutor(dir)
    const t1 = exec.resolve(db.users)
    const t2 = exec.resolve(db.users)
    check(t1 === t2, true)
  })
})
