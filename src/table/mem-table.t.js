import { memTable } from './mem-table.js'
import { capabilities, isTable } from './contract.js'
import { conform, ConformanceError } from './conformance.js'
import { cursorFromArray } from './cursor.js'

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

test('mem-table: e uma Table de nivel 0', ({ check }) => {
  const t = memTable(rows, schema)
  check(isTable(t), true)
  check(capabilities(t).level, 0)
  check(capabilities(t).has, { get: false, find: false, range: false, count: false, filter: false, group: false })
})

test('mem-table: dois cursores scan() sao independentes e intercalaveis', ({ check }) => {
  const t = memTable(rows, schema)
  const a = t.scan()
  const b = t.scan()
  check(a.next().id, 1)
  check(b.next().id, 1)
  check(a.next().id, 2)
  check(a.next().id, 3)
  check(b.next().id, 2)
  check(a.next().id, 4)
})

test('mem-table: scan() e iteravel com for..of', ({ check }) => {
  const t = memTable(rows, schema)
  const seen = []
  for (const r of t.scan()) seen.push(r.id)
  check(seen, [1, 2, 3, 4, 5])
})

test('mem-table: mutar o array de entrada depois de criar nao vaza pro scan', ({ check }) => {
  const source = rows.map(r => ({ ...r }))
  const t = memTable(source, schema)
  source.push({ id: 99, name: 'Ghost', age: 0 })
  source[0].name = 'Mutated'
  const seen = [...t.scan()]
  check(seen.length, 5)
  check(seen[0].name, 'Ana')
})

test('mem-table: conform() passa inteira contra a tabela de memoria', ({ check }) => {
  const ok = conform(rs => memTable(rs, schema), rows, { pk: 'id' })
  check(ok, true)
})

test('conform: reprova uma tabela cujos cursores compartilham posicao (lei da reentrancia)', ({ check }) => {
  function brokenSharedCursor(rs) {
    let i = 0
    const cursor = () => ({
      next() { return i < rs.length ? rs[i++] : null },
      close() {},
      [Symbol.iterator]() {
        return { next: () => { const v = this.next?.() ?? cursor().next(); return v === null ? { done: true } : { done: false, value: v } } }
      }
    })
    return { schema, scan: cursor }
  }

  let threw = false
  let law = null
  try {
    conform(brokenSharedCursor, rows, { pk: 'id' })
  } catch (e) {
    threw = true
    law = e instanceof ConformanceError ? e.law : null
  }
  check(threw, true)
  check(law, 'reentrancy')
})

test('conform: reprova um find() que devolve resultado errado (lei da equivalencia de capacidade)', ({ check }) => {
  function brokenFind(rs) {
    return {
      schema,
      scan: () => cursorFromArray(rs),
      get: key => rs.find(r => r.id === key) ?? null,
      find: () => cursorFromArray([rs[0]])
    }
  }

  let threw = false
  let law = null
  try {
    conform(brokenFind, rows, { pk: 'id' })
  } catch (e) {
    threw = true
    law = e instanceof ConformanceError ? e.law : null
  }
  check(threw, true)
  check(law, 'capability-equivalence')
})
