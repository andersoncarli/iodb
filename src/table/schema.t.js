import { normalizeSchema, schemaToCsvCols, csvColsToSchema, schemaLossToCsv } from './schema.js'
import { parseSchema, formatSchema } from '../tabular-projection.js'
import { conform, ConformanceError } from './conformance.js'
import { cursorFromArray } from './cursor.js'

const soml = {
  'id number pk autohash|autoinc': 0,
  'name string unique indexed': '',
  'state string null': '',
  'age number indexed': 0
}

const pojo = {
  fields: {
    id: { type: 'number', pk: true, autohash: true, autoinc: true, default: 0 },
    name: { type: 'string', unique: true, indexed: true, default: '' },
    state: { type: 'string', nullable: true, default: '' },
    age: { type: 'number', indexed: true, default: 0 }
  }
}

test('schema: SOML normaliza para o POJO canonico da TABLE.md secao 3', ({ check }) => {
  const got = normalizeSchema(soml)
  check(got, pojo)
})

test('schema: POJO ja normalizado passa por normalizeSchema sem mudar', ({ check }) => {
  const got = normalizeSchema(pojo)
  check(got, pojo)
})

test('schema: SOML aceita modificadores em qualquer ordem dentro da chave', ({ check }) => {
  const a = normalizeSchema({ 'age number indexed': 0 })
  const b = normalizeSchema({ 'age indexed number': 0 })
  check(a, b)
})

test('schema: normalizeSchema rejeita forma nao reconhecida', ({ check }) => {
  let threw = false
  try { normalizeSchema(42) } catch { threw = true }
  check(threw, true)
})

test('schema: lei de ida-e-volta para os quatro tipos, nullable, indexed, pk e unique', ({ check }) => {
  const wide = {
    fields: {
      id: { type: 'number', width: 'int', pk: true },
      score: { type: 'number', width: 'float', indexed: true },
      name: { type: 'string', unique: true },
      flag: { type: 'boolean', nullable: true }
    }
  }
  const { cols } = schemaToCsvCols(wide)
  const line = formatSchema(cols)
  const parsedCols = parseSchema(line)
  const back = csvColsToSchema(parsedCols)
  check(back, wide)
})

test('schema: schemaLossToCsv reporta exatamente default e autoinc/autohash', ({ check }) => {
  const loss = schemaLossToCsv(pojo)
  const keys = loss.map(l => `${l.field}.${l.key}`).sort()
  check(keys, ['id.autohash', 'id.autoinc', 'id.default', 'name.default', 'state.default', 'age.default'].sort())
})

test('schema: schemaLossToCsv e vazia para um schema sem default nem autoinc/autohash', ({ check }) => {
  const clean = { fields: { id: { type: 'number', pk: true }, name: { type: 'string', indexed: true } } }
  check(schemaLossToCsv(clean), [])
})

test('schema: coluna CSV com ! (pk) e = (unique), em qualquer ordem entre os quatro sufixos', ({ check }) => {
  const a = parseSchema('id:int!,email:str=@,age:int?@')
  check(a[0], { name: 'id', type: 'int', nullable: false, indexed: false, pk: true })
  check(a[1], { name: 'email', type: 'str', nullable: false, indexed: true, unique: true })
  check(a[2], { name: 'age', type: 'int', nullable: true, indexed: true })

  const b = parseSchema('id:int@!=?')
  check(b[0], { name: 'id', type: 'int', nullable: true, indexed: true, pk: true, unique: true })
})

test('conform: reprova get() presente sem campo pk no schema (lei do cruzamento schema/capacidade)', ({ check }) => {
  const rows = [{ id: 1, name: 'Ana' }, { id: 2, name: 'Bob' }]
  const schemaNoPk = { fields: { id: { type: 'number' }, name: { type: 'string' } } }
  function tableWithGetNoPk(rs) {
    return {
      schema: schemaNoPk,
      scan: () => cursorFromArray(rs),
      get: k => rs.find(r => r.id === k) ?? null
    }
  }
  let law = null
  try { conform(tableWithGetNoPk, rows, { pk: 'id' }) } catch (e) { law = e instanceof ConformanceError ? e.law : 'unknown' }
  check(law, 'schema-capability')
})

test('conform: reprova find() presente sem nenhum campo indexed/pk no schema', ({ check }) => {
  const rows = [{ id: 1, name: 'Ana' }, { id: 2, name: 'Bob' }]
  const schemaNoIndex = { fields: { id: { type: 'number', pk: true }, name: { type: 'string' } } }
  function tableWithFindNoIndex(rs) {
    return {
      schema: schemaNoIndex,
      scan: () => cursorFromArray(rs),
      get: k => rs.find(r => r.id === k) ?? null,
      find: (field, value) => cursorFromArray(rs.filter(r => r[field] === value))
    }
  }
  let law = null
  try { conform(tableWithFindNoIndex, rows, { pk: 'id' }) } catch (e) { law = e instanceof ConformanceError ? e.law : 'unknown' }
  check(law, 'schema-capability')
})

test('schema: fixture pre-8.2 (gramatica sem !/=) ainda parseia com o codigo atual, byte a byte', ({ check }) => {
  const fs = require('fs')
  const path = require('path').join(import.meta.dir, '../fixtures/tabular-pre-8.2.csv')
  const before = fs.readFileSync(path, 'utf8')
  const firstLine = before.split('\n')[0]
  const cols = parseSchema(firstLine)
  check(cols.map(c => c.name), ['name', 'age', 'score', 'active'])
  check(cols.every(c => !c.pk && !c.unique), true)
  const after = fs.readFileSync(path, 'utf8')
  check(after, before)
})
