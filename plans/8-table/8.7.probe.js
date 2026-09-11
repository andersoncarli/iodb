// Probe da feature 8.7 — o catalogo: db.users resolve uma Table, tarde e sem
// tocar o disco.
import { catalog, catalogExecutor, resolveSource } from '../../src/table/catalog.js'
import { isTable, capabilities } from '../../src/table/contract.js'
import { conform } from '../../src/table/conformance.js'
import { toArray } from '../../src/table/cursor.js'
import { TabularProjection } from '../../src/tabular-projection.js'
import { IO, merge } from '../../src/io-engine.js'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
const fsmod = require('fs')

const dir = mkdtempSync(join(tmpdir(), 'iodb-87-probe-'))

const rows = [
  { id: 1, name: 'Ana', age: 26 },
  { id: 2, name: 'Bob', age: 31 }
]

const csvProj = TabularProjection(join(dir, 'users.csv'), { schema: 'id:int!,name:str@,age:int' })
for (const r of rows) csvProj.push(r)
csvProj.flush()

const io = IO(join(dir, 'usersLog'), { reduce: merge, initial: {} })
io.open()
for (const r of rows) io.in({ [r.id]: { name: r.name, age: r.age } })

// Sem syscall no acesso.
const origExists = fsmod.existsSync
let calls = 0
fsmod.existsSync = (...a) => { calls++; return origExists(...a) }
const db = catalog(dir)
const usersNode = db.users
const fooNode = db.foo
console.log('node-shape:', JSON.stringify(usersNode))
console.log('foo-node-shape:', JSON.stringify(fooNode))
console.log('no-syscall-on-access:', calls === 0)
fsmod.existsSync = origExists

// Identidade estavel.
console.log('identity-stable:', db.users === db.users)

// Resolver csv -> conform().
const tCsv = resolveSource(usersNode, { dir })
console.log('isTable-csv:', isTable(tCsv))
console.log('conform-csv:', conform(() => resolveSource(usersNode, { dir }), toArray(tCsv.scan()), { pk: 'id' }))

// Resolver .dash -> conform().
const dashNode = { op: 'source', name: 'usersLog' }
const tDash = resolveSource(dashNode, { dir })
console.log('isTable-dash:', isTable(tDash))
console.log('conform-dash:', conform(() => resolveSource(dashNode, { dir }), toArray(tDash.scan()), { pk: '_key' }))

// Paridade: mesmos dados, capabilities diferentes.
const fromCsv = toArray(tCsv.scan()).map(r => r.name).sort()
const fromDash = toArray(tDash.scan()).map(r => r.name).sort()
console.log('same-data:', JSON.stringify(fromCsv) === JSON.stringify(fromDash))
console.log('caps-csv-level:', capabilities(tCsv).level)
console.log('caps-dash-level:', capabilities(tDash).level)

// Arquivo inexistente: nao lanca, devolve null.
const missing = resolveSource(fooNode, { dir })
console.log('missing-is-null:', missing === null)

// Cache de resolucao.
const exec = catalogExecutor(dir)
const a = exec.resolve(usersNode)
const b = exec.resolve(usersNode)
console.log('exec-cache:', a === b)

rmSync(dir, { recursive: true, force: true })
