// Probe da feature 8.5 — o log .dash vira Table: scan() em stream, L1
// (get+count) pelo caminho que ja existe, find/range ausentes de proposito.
import { IO, merge } from '../../src/io-engine.js'
import { ioTable } from '../../src/table/io-table.js'
import { isTable, capabilities } from '../../src/table/contract.js'
import { conform } from '../../src/table/conformance.js'
import { toArray } from '../../src/table/cursor.js'
import { mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'iodb-85-probe-'))

function seedIo(name, rows) {
  const io = IO(join(dir, name), { reduce: merge, initial: {} })
  io.open()
  for (const r of rows) io.in({ [r.id]: { name: r.name, age: r.age } })
  return io
}

const schema = {
  fields: {
    _key: { type: 'string', pk: true },
    name: { type: 'string' },
    age: { type: 'number' }
  }
}

const rows = [
  { id: 'a', name: 'Ana', age: 26 },
  { id: 'b', name: 'Bob', age: 31 },
  { id: 'c', name: 'Cid', age: 19 }
]

const io = seedIo('probe', rows)
const t = ioTable(io, schema)
console.log('isTable:', isTable(t))
const caps = capabilities(t)
console.log('level:', caps.level)
console.log('has:', JSON.stringify(caps.has))

const scanned = toArray(t.scan())
console.log('scan-count:', scanned.length)
console.log('scan-names:', scanned.map(r => r.name).sort().join(','))

const bRow = scanned.find(r => r.name === 'Bob')
console.log('get-matches-scan:', JSON.stringify(t.get(bRow._key)) === JSON.stringify(bRow))

console.log('count:', t.count())
console.log('conform:', conform(() => ioTable(io, schema), scanned, { pk: '_key' }))

// linesLive <= 1 num scan completo, mesmo com 500 registros.
const bigRows = []
for (let i = 0; i < 500; i++) bigRows.push({ id: 'k' + i, name: 'n' + i, age: i })
const bigIo = seedIo('big', bigRows)
const bigT = ioTable(bigIo, schema)
const c = bigT.scan()
let maxLive = 0, v
while ((v = c.next()) !== null) maxLive = Math.max(maxLive, c.linesLive)
console.log('maxLinesLive:', maxLive)
console.log('bytesRead-eq-filesize:', c.bytesRead === statSync(bigIo.path()).size)

// Pureza: cursor aberto antes de um in() nao ve o registro novo.
const pureIo = seedIo('purity', [{ id: 'a', name: 'Ana', age: 26 }])
const pureT = ioTable(pureIo, schema)
const pureCursor = pureT.scan()
pureIo.in({ z: { name: 'Zed', age: 99 } })
const pureSeen = toArray(pureCursor)
console.log('purity-no-new-record:', !pureSeen.some(r => r.name === 'Zed'))

rmSync(dir, { recursive: true, force: true })
