import { capabilities } from './contract.js'
import { filterCursor, firstOf, countOf, toArray } from './cursor.js'

// O oraculo: conform(makeTable, rows, opts) recebe uma FABRICA de tabela e o
// conjunto de linhas esperado, e afirma as leis do contrato (TABLE.md secoes 4, 14).
// Um backend so e Table se conform() passa. As comparacoes sao por CONJUNTO, nunca
// por sequencia, porque ordem nao e garantida (TABLE.md secao 14) -- salvo `pk`,
// que por definicao identifica uma unica linha.
export function conform(makeTable, rows, opts = {}) {
  const pk = opts.pk ?? findPk(makeTable(rows))
  const fail = (law, msg) => { throw new ConformanceError(law, msg) }

  reentrancy(makeTable, rows, fail)
  purity(makeTable, rows, fail)
  capabilityEquivalence(makeTable, rows, pk, fail)
  schemaCapabilityCrosscheck(makeTable, rows, fail)

  return true
}

export class ConformanceError extends Error {
  constructor(law, msg) {
    super(`[${law}] ${msg}`)
    this.law = law
  }
}

function findPk(table) {
  for (const [name, field] of Object.entries(table.schema?.fields ?? {})) {
    if (field.pk) return name
  }
  return null
}

// Lei 1 -- REENTRANCIA: dois cursores abertos ao mesmo tempo, com next()
// intercalado, cada um ve a sequencia completa e independente.
function reentrancy(makeTable, rows, fail) {
  const t = makeTable(rows)
  const a = t.scan()
  const b = t.scan()

  const seenA = []
  const seenB = []
  let va = a.next(), vb = b.next()
  while (va !== null || vb !== null) {
    if (va !== null) { seenA.push(va); va = a.next() }
    if (vb !== null) { seenB.push(vb); vb = b.next() }
  }

  if (seenA.length !== rows.length || seenB.length !== rows.length) {
    fail('reentrancy', `cursores independentes devolveram ${seenA.length}/${seenB.length} linhas, esperado ${rows.length} em cada -- cursores provavelmente compartilham posicao`)
  }
  if (!sameSet(seenA, seenB)) {
    fail('reentrancy', 'os dois cursores viram conjuntos diferentes de linhas')
  }
}

// Lei 2 -- PUREZA: rodar scan/get/find/range/count N vezes nao muda nenhuma
// resposta subsequente nem o estado observavel.
function purity(makeTable, rows, fail) {
  const t = makeTable(rows)
  const first = toArray(t.scan())
  toArray(t.scan())
  toArray(t.scan())
  const third = toArray(t.scan())

  if (!sameSet(first, third)) {
    fail('purity', 'scan() repetido devolveu conjuntos diferentes -- leitura esta mutando estado observavel')
  }
}

// Lei 3 -- EQUIVALENCIA DE CAPACIDADE: para cada capacidade presente, o
// resultado bate CONJUNTO-A-CONJUNTO com o fallback por varredura.
function capabilityEquivalence(makeTable, rows, pk, fail) {
  const t = makeTable(rows)
  const { has } = capabilities(t)

  if (has.get) {
    if (!pk) fail('capability-equivalence', 'get() presente mas nenhum campo pk no schema -- nao ha como derivar o oraculo')
    for (const row of rows) {
      const key = row[pk]
      const got = t.get(key)
      const expected = firstOf(filterCursor(t.scan(), r => r[pk] === key)) ?? null
      if (!sameRow(got, expected)) {
        fail('capability-equivalence', `get(${JSON.stringify(key)}) = ${JSON.stringify(got)}, esperado ${JSON.stringify(expected)} (scan |> filter(pk==key) |> first)`)
      }
    }
    const missingKey = uniqueMissingValue(rows.map(r => r[pk]))
    if (t.get(missingKey) !== null && t.get(missingKey) !== undefined) {
      fail('capability-equivalence', `get() com chave inexistente deveria devolver null`)
    }
  }

  if (has.find) {
    for (const field of sampleFields(rows)) {
      for (const value of sampleValues(rows, field)) {
        const got = toArray(t.find(field, value))
        const expected = toArray(filterCursor(t.scan(), r => r[field] === value))
        if (!sameSet(got, expected)) {
          fail('capability-equivalence', `find(${field}, ${JSON.stringify(value)}) nao bate com scan |> filter(eq)`)
        }
      }
    }
  }

  if (has.range) {
    for (const field of sampleFields(rows)) {
      const values = rows.map(r => r[field]).filter(v => typeof v === 'number')
      if (values.length === 0) continue
      const bounds = { gte: Math.min(...values), lt: Math.max(...values) }
      const got = toArray(t.range(field, bounds))
      const expected = toArray(filterCursor(t.scan(), r => inBounds(r[field], bounds)))
      if (!sameSet(got, expected)) {
        fail('capability-equivalence', `range(${field}, ${JSON.stringify(bounds)}) nao bate com scan |> filter(between)`)
      }
    }
  }

  if (has.count) {
    const got = t.count()
    const expected = countOf(t.scan())
    if (got !== expected) {
      fail('capability-equivalence', `count() = ${got}, esperado ${expected} (scan |> count)`)
    }
  }
}

// Lei 5 -- CRUZAMENTO SCHEMA/CAPACIDADE (8.2): o schema alimenta o otimizador,
// nao so a validacao (TABLE.md secao 3). get() sem pk no schema, ou find()
// sem nenhum campo indexed (pk sozinho nao basta -- indexed -> find()/range()
// e um eixo diferente de pk -> get()), e contrato inconsistente -- a
// capacidade promete o que o schema nao sustenta.
function schemaCapabilityCrosscheck(makeTable, rows, fail) {
  const t = makeTable(rows)
  const { has } = capabilities(t)
  const fields = t.schema?.fields ?? {}
  const hasPk = Object.values(fields).some(f => f.pk)
  const hasIndexed = Object.values(fields).some(f => f.indexed)

  if (has.get && !hasPk) {
    fail('schema-capability', 'get() presente mas nenhum campo pk no schema -- pk -> get() e a regra (TABLE.md secao 3)')
  }
  if (has.find && !hasIndexed) {
    fail('schema-capability', 'find() presente mas nenhum campo indexed no schema -- indexed -> find()/range() e a regra (TABLE.md secao 3)')
  }
}

function inBounds(v, { gt, gte, lt, lte }) {
  if (gt !== undefined && !(v > gt)) return false
  if (gte !== undefined && !(v >= gte)) return false
  if (lt !== undefined && !(v < lt)) return false
  if (lte !== undefined && !(v <= lte)) return false
  return true
}

function sampleFields(rows) {
  return Object.keys(rows[0] ?? {})
}

function sampleValues(rows, field) {
  return [...new Set(rows.map(r => r[field]))]
}

function uniqueMissingValue(values) {
  const set = new Set(values)
  let candidate = '__missing__'
  let i = 0
  while (set.has(candidate)) candidate = `__missing__${i++}`
  return candidate
}

function sameRow(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function sameSet(a, b) {
  if (a.length !== b.length) return false
  const bStrs = b.map(r => JSON.stringify(r)).sort()
  const aStrs = a.map(r => JSON.stringify(r)).sort()
  return aStrs.every((s, i) => s === bStrs[i])
}
