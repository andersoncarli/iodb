// Probe da feature 8.2 — gramaticas SOML e CSV normalizadas para o mesmo POJO,
// lei de ida-e-volta, e a quinta lei de conformidade (schema-capability).
import { readFileSync } from 'fs'
import { normalizeSchema, schemaToCsvCols, csvColsToSchema, schemaLossToCsv } from '../../src/table/schema.js'
import { parseSchema, formatSchema } from '../../src/tabular-projection.js'
import { conform, ConformanceError } from '../../src/table/conformance.js'
import { cursorFromArray } from '../../src/table/cursor.js'

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

console.log('soml-normalizes-to-pojo:', JSON.stringify(normalizeSchema(soml)) === JSON.stringify(pojo))

// Ida-e-volta: POJO -> colunas CSV -> linha -> colunas -> POJO.
const wide = { fields: { id: { type: 'number', width: 'int', pk: true }, score: { type: 'number', width: 'float', indexed: true } } }
const { cols } = schemaToCsvCols(wide)
const line = formatSchema(cols)
const back = csvColsToSchema(parseSchema(line))
console.log('roundtrip:', JSON.stringify(back) === JSON.stringify(wide))

// O que se perde para CSV: default e autoinc/autohash, e nada mais.
const loss = schemaLossToCsv(pojo).map(l => `${l.field}.${l.key}`).sort().join(',')
console.log('loss:', loss)

// Sufixos !/= em qualquer ordem, junto de ?/@.
const c = parseSchema('id:int@!=?')[0]
console.log('four-axes:', JSON.stringify({ pk: c.pk, unique: c.unique, indexed: c.indexed, nullable: c.nullable }))

// Fixture pre-8.2: o codigo de hoje le a gramatica de ontem, byte a byte.
const before = readFileSync(new URL('../../src/fixtures/tabular-pre-8.2.csv', import.meta.url), 'utf8')
const fixtureCols = parseSchema(before.split('\n')[0])
console.log('fixture-fields:', fixtureCols.map(c => c.name).join(','))
console.log('fixture-no-pk-no-unique:', fixtureCols.every(c => !c.pk && !c.unique))

// A quinta lei: get() sem pk, find() sem indexed.
const rows = [{ id: 1, name: 'Ana' }, { id: 2, name: 'Bob' }]
function tableGetNoPk(rs) {
  return { schema: { fields: { id: { type: 'number' }, name: { type: 'string' } } }, scan: () => cursorFromArray(rs), get: k => rs.find(r => r.id === k) ?? null }
}
let lawGet = null
try { conform(tableGetNoPk, rows, { pk: 'id' }) } catch (e) { lawGet = e instanceof ConformanceError ? e.law : 'unknown' }
console.log('broken-schema-capability-get:', lawGet)

function tableFindNoIndex(rs) {
  return {
    schema: { fields: { id: { type: 'number', pk: true }, name: { type: 'string' } } },
    scan: () => cursorFromArray(rs),
    get: k => rs.find(r => r.id === k) ?? null,
    find: (f, v) => cursorFromArray(rs.filter(r => r[f] === v))
  }
}
let lawFind = null
try { conform(tableFindNoIndex, rows, { pk: 'id' }) } catch (e) { lawFind = e instanceof ConformanceError ? e.law : 'unknown' }
console.log('broken-schema-capability-find:', lawFind)
