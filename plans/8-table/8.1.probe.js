// Probe da feature 8.1 — roda os cenarios do contrato Table e imprime linhas
// que o eval.js confere. Nao usa utest (que precisaria do runner global); e um
// script solto que importa os modulos direto.
import { memTable } from '../../src/table/mem-table.js'
import { isTable, capabilities } from '../../src/table/contract.js'
import { conform, ConformanceError } from '../../src/table/conformance.js'
import { cursorFromArray } from '../../src/table/cursor.js'

const schema = {
  fields: {
    id: { type: 'number', pk: true, default: 0 },
    name: { type: 'string', default: '' },
    age: { type: 'number', default: 0 }
  }
}

const rows = [
  { id: 1, name: 'Ana', age: 26 },
  { id: 2, name: 'Bob', age: 31 },
  { id: 3, name: 'Cid', age: 19 },
  { id: 4, name: 'Dan', age: 45 },
  { id: 5, name: 'Eva', age: 26 }
]

const t = memTable(rows, schema)
console.log('isTable:', isTable(t))
console.log('level:', capabilities(t).level)

let conformOk = false
try {
  conformOk = conform(rs => memTable(rs, schema), rows, { pk: 'id' })
} catch (e) {
  console.log('conform-error:', e.message)
}
console.log('conform-mem-table:', conformOk)

// Cursores independentes, intercalados.
const a = t.scan()
const b = t.scan()
const interleaved = [a.next().id, b.next().id, a.next().id, b.next().id]
console.log('interleaved:', interleaved.join(','))

// Tabela quebrada 1: cursores compartilham posicao.
function brokenSharedCursor(rs) {
  let i = 0
  return {
    schema,
    scan: () => ({
      next() { return i < rs.length ? rs[i++] : null },
      close() {},
      [Symbol.iterator]() { return { next: () => { const v = this.next(); return v === null ? { done: true } : { done: false, value: v } } } }
    })
  }
}
let brokenReentrancyLaw = null
try {
  conform(brokenSharedCursor, rows, { pk: 'id' })
} catch (e) {
  brokenReentrancyLaw = e instanceof ConformanceError ? e.law : 'unknown-error'
}
console.log('broken-reentrancy-law:', brokenReentrancyLaw)

// Tabela quebrada 2: find() devolve resultado errado.
function brokenFind(rs) {
  return {
    schema,
    scan: () => cursorFromArray(rs),
    get: key => rs.find(r => r.id === key) ?? null,
    find: () => cursorFromArray([rs[0]])
  }
}
let brokenCapabilityLaw = null
try {
  conform(brokenFind, rows, { pk: 'id' })
} catch (e) {
  brokenCapabilityLaw = e instanceof ConformanceError ? e.law : 'unknown-error'
}
console.log('broken-capability-law:', brokenCapabilityLaw)
