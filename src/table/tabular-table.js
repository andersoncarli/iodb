/**
 * tabular-table.js — feature 8.4
 *
 * Veste o contrato {schema, scan, get, find, range, count} sobre
 * `TabularProjection` (2.2, 🔵), que ja tem schema tipado e range com
 * descarte de pagina por min/max. Nada de capacidade nova aqui — so o
 * contrato por cima do que ja foi construido e confirmado.
 *
 * Nivel 3 (get+find+range) so quando o schema declara `pk`/`indexed`
 * (8.2 deu esses eixos a gramatica CSV). Sem eles, e L0 + count: declarar
 * `find` sempre presente mentiria sobre capacidade.
 */
import { TabularProjection } from '../tabular-projection.js'
import { csvColsToSchema } from './schema.js'
import { pageCursor } from './page-cursor.js'
import { mapCursor, filterCursor, firstOf, toArray } from './cursor.js'

export function tabularTable(file, opts = {}) {
  const proj = TabularProjection(file, opts)
  const schema = csvColsToSchema(proj.schema)
  const cols = proj.schema
  const pkCol = cols.find(c => c.pk)
  const indexedCols = new Set(cols.filter(c => c.indexed).map(c => c.name))

  // scan() preguicoso: mesma tecnica de avanco-por-pagina da 8.3, mas
  // decodificando ROWS via `_pageRows` (ja pula schema e enchimento) em vez
  // de ceder a linha crua.
  function scan() {
    proj._ensureFlushed()
    proj._resetPagesRead()
    return pageCursorOfRows()
  }

  function pageCursorOfRows() {
    const store = proj._store
    // Cada linha de uma pagina decodificada e cedida como um "item" do
    // pageCursor generico — a pagina inteira e o vetor de ROWS, nao de
    // linhas cruas, entao o mesmo motor de avanco-por-pagina serve.
    return pageCursor(store, 0, (i) => { proj._bumpPagesRead(); return proj._pageRows(i) })
  }

  /** range() como cursor, mantendo o descarte de pagina do TabularProjection
   *  original: reusa `proj.range` (que ja pula paginas fora do intervalo por
   *  min/max) e serve o array resultante via cursor — o pagesRead do
   *  descarte fica visivel em `proj.pagesRead` logo apos a chamada. */
  function range(name, bounds = {}) {
    const lo = bounds.gte ?? bounds.gt
    const hi = bounds.lte ?? bounds.lt
    const rows = proj.range(name, lo, hi)
    const filtered = rows.filter(r => {
      const v = r[name]
      if (v === null || v === undefined) return false
      if (bounds.gt !== undefined && !(v > bounds.gt)) return false
      if (bounds.gte !== undefined && !(v >= bounds.gte)) return false
      if (bounds.lt !== undefined && !(v < bounds.lt)) return false
      if (bounds.lte !== undefined && !(v <= bounds.lte)) return false
      return true
    })
    let i = 0
    return {
      next() { return i < filtered.length ? filtered[i++] : null },
      close() { i = filtered.length },
      [Symbol.iterator]() {
        return { next: () => { const v = this.next(); return v === null ? { done: true } : { done: false, value: v } } }
      }
    }
  }

  const table = {
    get schema() { return schema },

    scan,

    /** count() O(paginas do indice) -- soma do indice por pagina, nunca abre
     *  pagina de dados. */
    count() {
      return proj.rowCount()
    }
  }

  // get/find so existem quando o schema os sustenta -- ausente, nao lento
  // (TABLE.md: declarar rapido o que e O(n) engana o otimizador).
  if (pkCol) {
    table.get = (key) => {
      if (indexedCols.has(pkCol.name)) return firstOf(range(pkCol.name, { gte: key, lte: key })) ?? null
      return firstOf(filterCursor(scan(), r => r[pkCol.name] === key)) ?? null
    }
  }

  if (indexedCols.size > 0) {
    table.find = (field, value) => {
      if (indexedCols.has(field)) return range(field, { gte: value, lte: value })
      return filterCursor(scan(), r => r[field] === value)
    }
    table.range = (field, bounds) => range(field, bounds)
  }

  return table
}
