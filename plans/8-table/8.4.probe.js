// Probe da feature 8.4 — a projecao tabular vestida com o contrato Table,
// nivel 3 quando o schema tem pk+indexed, nivel 0+count quando nao.
import { TabularProjection } from '../../src/tabular-projection.js'
import { tabularTable } from '../../src/table/tabular-table.js'
import { isTable, capabilities } from '../../src/table/contract.js'
import { conform } from '../../src/table/conformance.js'
import { toArray } from '../../src/table/cursor.js'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'iodb-84-probe-'))

function seed(name, schema, rows, opts = {}) {
  const file = join(dir, name)
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

// pk + indexed: get+find+range+count -- nivel 4 na formula da 8.1 (count()
// sempre presente aqui, O(indice); "nivel 3" no plano da 8.4 se referia a
// range como a capacidade nova, nao ao numero exato da formula acumulativa).
const fileL3 = seed('l3.csv', 'id:int!,name:str@,age:int@', rows)
const tL3 = tabularTable(fileL3)
console.log('isTable:', isTable(tL3))
console.log('level3:', capabilities(tL3).level)
console.log('get3:', JSON.stringify(tL3.get(3)))
console.log('find-age26:', toArray(tL3.find('age', 26)).map(r => r.id).sort().join(','))
console.log('conform-l3:', conform(() => tabularTable(fileL3), rows, { pk: 'id' }))

// L0+count: sem indice nenhum.
const fileL0 = seed('l0.csv', 'id:int,name:str,age:int', rows)
const tL0 = tabularTable(fileL0)
console.log('level0:', capabilities(tL0).level)
console.log('has-get0:', capabilities(tL0).has.get)
console.log('has-count0:', capabilities(tL0).has.count)
console.log('count0:', tL0.count())
console.log('conform-l0:', conform(() => tabularTable(fileL0), rows, { pk: 'id' }))

// range() mantem o descarte de pagina.
const big = []
for (let i = 0; i < 500; i++) big.push({ id: i, name: 'n' + i, age: i % 100 })
const fileBig = seed('big.csv', 'id:int!,name:str,age:int@', big, { pageSize: 256 })
const projBig = TabularProjection(fileBig, { pageSize: 256 })
projBig.all()
const totalPages = projBig.pagesRead
const rangeResult = projBig.range('age', 0, 0)
const rangePages = projBig.pagesRead
console.log('range-discard:', rangePages < totalPages, `(${rangePages} < ${totalPages})`)
console.log('range-count:', rangeResult.length)

// limit(10) sobre scan() le O(1) paginas.
const hugeRows = []
for (let i = 0; i < 3000; i++) hugeRows.push({ id: i, name: 'n' + i, age: i % 50 })
const fileHuge = seed('huge.csv', 'id:int!,name:str,age:int', hugeRows, { pageSize: 512 })
const tHuge = tabularTable(fileHuge, { pageSize: 512 })
const c = tHuge.scan()
let n = 0, v
while (n < 10 && (v = c.next()) !== null) n++
c.close()
console.log('limit10-len:', n)

rmSync(dir, { recursive: true, force: true })
