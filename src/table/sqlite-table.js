/**
 * sqlite-table.js — feature 8.6
 *
 * O contrario da 8.5: se o `.dash` e a fonte que so sabe varrer, o sqlite e a
 * que sabe fazer quase tudo internamente -- indice, range, count, filter,
 * group. Nivel 5: `filter`/`group` empurrados para SQL, com fallback
 * generico da 8.1 para o que nao se traduz.
 *
 * `schema` VEM DO PROPRIO BANCO: PRAGMA table_info/index_list/index_info,
 * normalizado pelo POJO da 8.2 -- nenhuma gramatica, e ainda assim ha
 * schema. `scan()` usa `col.iterate()` (stmt.iterate() do driver), nao
 * `all()` embrulhado -- `rowsFetched` prova que um scan interrompido nao
 * buscou a tabela inteira.
 */
import { csvColsToSchema } from './schema.js'

const SQL_TO_TYPE = { TEXT: 'string', INTEGER: 'number', REAL: 'number', BLOB: 'string' }

function readSchema(col) {
  const table = col.__table
  const cols = col.query(`PRAGMA table_info(${table})`)
  const indexList = col.query(`PRAGMA index_list(${table})`)

  const indexedCols = new Set()
  const uniqueCols = new Set()
  for (const idx of indexList) {
    // O indice automatico da PK (`origin:'pk'`) ja e coberto por `pk` ->
    // get(); contar essa coluna como `indexed` tambem ativaria find()/range()
    // numa tabela sem NENHUM indice de usuario -- L1 viraria L5 de graca.
    if (idx.origin === 'pk') continue
    const info = col.query(`PRAGMA index_info(${idx.name})`)
    if (info.length !== 1) continue   // indice composto: fora do escopo desta feature
    const colName = info[0].name
    indexedCols.add(colName)
    if (idx.unique) uniqueCols.add(colName)
  }

  const fields = {}
  for (const c of cols) {
    const field = { type: SQL_TO_TYPE[c.type?.toUpperCase()] ?? 'string' }
    if (c.pk) field.pk = true
    if (!c.notnull && !c.pk) field.nullable = true
    if (indexedCols.has(c.name)) field.indexed = true
    if (uniqueCols.has(c.name)) field.unique = true
    fields[c.name] = field
  }
  return { fields }
}

function toRow(sqlRow) {
  // JSON.stringify no adapter (`enc()`) grava objeto/array como TEXT; aqui a
  // Table devolve o valor cru do driver -- decodificar de volta para objeto
  // e responsabilidade de quem sabe que a coluna e desse tipo, nao da Table.
  return { ...sqlRow }
}

/** Escopo DELIBERADAMENTE PEQUENO de `filter`: eq, comparacoes, and/or sobre
 *  coluna e literal. O que nao se traduz devolve `null` e o chamador cai no
 *  fallback (scan|>filter) da 8.1 -- recusar com elegancia e requisito. */
function translateFilter(expr, fields) {
  if (!expr || typeof expr !== 'object') return null
  const { op } = expr

  if (op === 'and' || op === 'or') {
    const parts = (expr.args ?? []).map(a => translateFilter(a, fields))
    if (parts.some(p => p === null)) return null
    return { sql: parts.map(p => `(${p.sql})`).join(op === 'and' ? ' AND ' : ' OR '), params: parts.flatMap(p => p.params) }
  }

  const { field, value } = expr
  if (!field || !(field in fields)) return null
  // ARMADILHA 1 -- ver find(): eq/ne com null precisam de IS [NOT] NULL.
  if (op === 'eq' && value === null) return { sql: `${field} IS NULL`, params: [] }
  if (op === 'ne' && value === null) return { sql: `${field} IS NOT NULL`, params: [] }
  const OPS = { eq: '=', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' }
  const sqlOp = OPS[op]
  if (!sqlOp) return null
  return { sql: `${field} ${sqlOp} ?`, params: [value] }
}

export function sqliteTable(col, table) {
  if (!table) throw new Error('sqliteTable: nome da tabela e obrigatorio (col.query nao expoe o { table } passado a SqliteCollection)')
  col.__table = table

  const schema = readSchema(col)
  const pkCol = Object.entries(schema.fields).find(([, f]) => f.pk)?.[0]
  const indexedFields = Object.entries(schema.fields).filter(([, f]) => f.indexed).map(([n]) => n)

  const t = {
    get schema() { return schema },

    scan() {
      const it = col.iterate(`SELECT * FROM ${table}`)
      let rowsFetched = 0
      let done = false
      return {
        get rowsFetched() { return rowsFetched },
        next() {
          if (done) return null
          const { value, done: d } = it.next()
          if (d) { done = true; return null }
          rowsFetched++
          return toRow(value)
        },
        close() {
          done = true
          it.return?.()
        },
        [Symbol.iterator]() {
          return {
            next: () => {
              const v = this.next()
              return v === null ? { done: true, value: undefined } : { done: false, value: v }
            }
          }
        }
      }
    },

    count() {
      return col.query(`SELECT count(*) as n FROM ${table}`)[0].n
    }
  }

  if (pkCol) {
    t.get = (key) => {
      const rows = col.query(`SELECT * FROM ${table} WHERE ${pkCol} = ?`, [key])
      return rows.length ? toRow(rows[0]) : null
    }
  }

  if (indexedFields.length > 0) {
    t.find = (field, value) => {
      if (!indexedFields.includes(field)) return scanFallback(field, value)
      // ARMADILHA 1 -- NULL em SQL nao e `null` em JS: `WHERE x = NULL` (ou
      // bind de null) nunca casa nada, `NULL = NULL` e desconhecido, nao
      // verdadeiro. O fallback scan|>filter usa `===` de JS, onde
      // `null === null` e true. Pra bater com o executor generico da 8.1,
      // `value === null` vira `IS NULL`, nao `= ?`.
      const rows = value === null
        ? col.query(`SELECT * FROM ${table} WHERE ${field} IS NULL`)
        : col.query(`SELECT * FROM ${table} WHERE ${field} = ?`, [value])
      return arrayCursor(rows.map(toRow))
    }
    t.range = (field, bounds = {}) => {
      const clauses = []
      const params = []
      if (bounds.gt !== undefined) { clauses.push(`${field} > ?`); params.push(bounds.gt) }
      if (bounds.gte !== undefined) { clauses.push(`${field} >= ?`); params.push(bounds.gte) }
      if (bounds.lt !== undefined) { clauses.push(`${field} < ?`); params.push(bounds.lt) }
      if (bounds.lte !== undefined) { clauses.push(`${field} <= ?`); params.push(bounds.lte) }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      const rows = col.query(`SELECT * FROM ${table} ${where}`, params)
      return arrayCursor(rows.map(toRow))
    }
  }

  function scanFallback(field, value) {
    const rows = []
    for (const r of t.scan()) if (r[field] === value) rows.push(r)
    return arrayCursor(rows)
  }

  // Nivel 5: filter/group empurrados para SQL, com fallback generico da 8.1
  // (scan|>filter) para o que nao se traduz.
  t.filter = (expr) => {
    const translated = translateFilter(expr, schema.fields)
    if (!translated) return null
    const rows = col.query(`SELECT * FROM ${table} WHERE ${translated.sql}`, translated.params)
    return arrayCursor(rows.map(toRow))
  }

  t.group = (key) => {
    if (!(key in schema.fields)) return null
    const rows = col.query(`SELECT ${key} as _group, count(*) as _count FROM ${table} GROUP BY ${key}`)
    return arrayCursor(rows)
  }

  return t
}

function arrayCursor(rows) {
  let i = 0
  return {
    next() { return i < rows.length ? rows[i++] : null },
    close() { i = rows.length },
    [Symbol.iterator]() {
      return {
        next: () => {
          const v = this.next()
          return v === null ? { done: true, value: undefined } : { done: false, value: v }
        }
      }
    }
  }
}
