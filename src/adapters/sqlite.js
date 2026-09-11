/**
 * io/adapters/50-sqlite.js — Minimal but powerful SQLite adapter for Bun
 *
 * Two doors on the same collection:
 *
 *   1. Raw SQL passthrough — `query(sql)`, `run(sql)`, `get(tableName)`, and
 *      `in({ table: row })` as a bare INSERT. Unchanged; every existing caller
 *      (db-factory.js `.sql()`, src/db.io.t.js) keeps working.
 *
 *   2. Keyed store surface — `put(id, row)`, `remove(id)`, `all()`, `flush()`,
 *      matching `IO(base, { reduce: merge })` call-for-call. Opt in by passing
 *      `{ table }` to the factory: that names the one table the keyed calls
 *      operate on, with `id` as PRIMARY KEY. `merge`'s `null` = delete-the-key
 *      maps to `DELETE FROM {table} WHERE id = ?`, so `all()` after a `remove`
 *      matches the iodb projection after an `io.in({ [id]: null })`.
 */
import { Database } from 'bun:sqlite'
import { existsSync } from 'fs'
import { dirname } from 'path'
import { mkdirSync } from 'fs'
import { registerIndex } from '../index-registry.js'

const sqlType = v =>
  typeof v === 'number' ? (Number.isInteger(v) ? 'INTEGER' : 'REAL') : 'TEXT'

// Objects/arrays are stringified on write; scalars pass through. Reads return
// whatever SQLite stored — the caller knows its own schema.
const enc = v =>
  v !== null && typeof v === 'object' ? JSON.stringify(v) : v

export function SqliteCollection(filePath, opts = {}) {
  let db = null
  const table = opts.table || null
  let ensured = false

  // CREATE TABLE IF NOT EXISTS on first keyed write, columns from the first
  // row's keys. A later row carrying a new key gets an ALTER TABLE ADD COLUMN —
  // so a column can appear over time the way a key appears in iodb's merge
  // projection (a file seen first, then measured, gains `size`).
  let cols = new Set()
  const ensureTable = row => {
    const keys = Object.keys(row)
    if (!ensured) {
      const defs = keys
        .map(c => (c === 'id' ? 'id ' + sqlType(row[c]) + ' PRIMARY KEY' : c + ' ' + sqlType(row[c])))
        .join(', ')
      const withId = keys.includes('id') ? defs : 'id TEXT PRIMARY KEY, ' + defs
      db.run(`CREATE TABLE IF NOT EXISTS ${table} (${withId})`)
      cols = new Set(keys.includes('id') ? keys : ['id', ...keys])
      ensured = true
      return
    }
    for (const c of keys) {
      if (cols.has(c)) continue
      db.run(`ALTER TABLE ${table} ADD COLUMN ${c} ${sqlType(row[c])}`)
      cols.add(c)
    }
  }

  const looksKeyed = patch => {
    if (!table) return false
    const vals = Object.values(patch)
    if (vals.length === 0) return false
    return vals.every(v => v === null || (typeof v === 'object' && !Array.isArray(v)))
  }

  const col = {
    open() {
      if (db) return this
      if (filePath) {
        const dir = dirname(filePath)
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      }
      db = new Database(filePath || ':memory:', {
        readonly: !!opts.readOnly,
        create: !opts.readOnly
      })
      return this
    },

    /** Run a query and return all results */
    query(sql, params) {
      if (!db) this.open()
      const q = db.query(sql)
      return (params !== undefined) ? q.all(params) : q.all()
    },

    /** Execute a statement */
    run(sql, params) {
      if (!db) this.open()
      return (params !== undefined) ? db.run(sql, params) : db.run(sql)
    },

    // ── Keyed store surface (opt in with `{ table }`) ──────────────────────

    /** Upsert one row by id. Equivalent to `io.in({ [id]: row })`. */
    put(id, row) {
      if (!db) this.open()
      if (!table) throw new Error('[sqlite] put(id, row) requires the factory to be given { table }')
      const full = { id, ...row }
      ensureTable(full)
      const cols = Object.keys(full)
      const vals = cols.map(c => enc(full[c]))
      const ph = cols.map(() => '?').join(', ')
      const setClause = cols.filter(c => c !== 'id').map(c => `${c}=excluded.${c}`).join(', ')
      const sql = setClause
        ? `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph}) ON CONFLICT(id) DO UPDATE SET ${setClause}`
        : `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph}) ON CONFLICT(id) DO NOTHING`
      db.run(sql, vals)
      return 'sqlite-ok'
    },

    /** Delete one row by id. Equivalent to `io.in({ [id]: null })` (merge tombstone). */
    remove(id) {
      if (!db) this.open()
      if (!table) throw new Error('[sqlite] remove(id) requires the factory to be given { table }')
      if (!ensured) return 'sqlite-ok'
      db.run(`DELETE FROM ${table} WHERE id = ?`, [id])
      return 'sqlite-ok'
    },

    /** All rows of the keyed table. Equivalent to `Object.values(io.get('#1'))`. */
    all() {
      if (!db) this.open()
      if (!table) throw new Error('[sqlite] all() requires the factory to be given { table }')
      if (!ensured) return []
      return db.query(`SELECT * FROM ${table}`).all()
    },

    /** No-op: SQLite is already durable per statement. Present so a caller
     *  need not know which backend is underneath. */
    flush() { return },

    // ── Reactive interface compatibility ─────────────────────────────────

    /** Heuristic: if k is a table name, return all its rows. */
    get(k) {
      if (!db) this.open()
      try {
        return db.query(`SELECT * FROM ${k}`).all()
      } catch {
        return undefined
      }
    },

    in(patch) {
      if (!db) this.open()
      // Keyed form — `{ [id]: row }` / `{ [id]: null }`, the same shape iodb's
      // MetadataStore passes. Routes per key to put/remove on the named table.
      if (looksKeyed(patch)) {
        for (const [id, row] of Object.entries(patch)) {
          if (row === null) this.remove(id)
          else this.put(id, row)
        }
        return 'sqlite-ok'
      }
      // Raw form — `{ table: row }` as a bare INSERT. Unchanged.
      for (const [t, row] of Object.entries(patch)) {
        if (typeof row === 'object' && row !== null) {
          const keys = Object.keys(row)
          const vals = Object.values(row)
          const placeholders = keys.map(() => '?').join(', ')
          const sql = `INSERT INTO ${t} (${keys.join(', ')}) VALUES (${placeholders})`
          db.run(sql, vals)
        }
      }
      return 'sqlite-ok'
    },

    out(handler) {
      // Potentially hook into a trigger, but for now just a stub
      return () => {}
    },

    close() {
      if (db) db.close()
      db = null
    },
    hasChildren: () => true,
    get size() {
       if (!db) return 0
       // Keyed collection: row count of the named table. Otherwise: table count.
       if (table) {
         if (!ensured) return 0
         return db.query(`SELECT count(*) as count FROM ${table}`).get().count
       }
       return db.query("SELECT count(*) as count FROM sqlite_master WHERE type='table'").get().count
    }
  }

  return new Proxy(col, {
    get(t, k) {
      if (typeof k === 'symbol' || k in t) return t[k]
      return t.get(String(k))
    }
  })
}

export const extensions = ['sqlite', 'db']
export default SqliteCollection

registerIndex('sqlite', SqliteIndex)

/**
 * Implementacao do contrato de indice (src/index-contract.js) usando bun:sqlite
 * como motor chave->offset. Tabela dedicada `idx`, id TEXT PRIMARY KEY — a
 * mesma B-tree nativa medida no spike da 2.4 (fast-open e range em ordens de
 * grandeza mais rapido que o replay do .dash; ver plans/2-pagedtext/2.4.spike.js).
 *
 * Nao reusa SqliteCollection porque o formato aqui e mais estreito (chave ->
 * offset numerico, nao linha arbitraria) — reusar forcaria JSON.stringify/parse
 * de um offset, custo que o contrato nao pede.
 */
export function SqliteIndex(filePath, opts = {}) {
  let db = null

  return {
    open() {
      if (db) return
      if (filePath && filePath !== ':memory:') {
        const dir = dirname(filePath)
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      }
      db = new Database(filePath || ':memory:', { create: true })
      db.run('CREATE TABLE IF NOT EXISTS idx (key TEXT PRIMARY KEY, offset INTEGER)')
    },

    close() {
      if (db) db.close()
      db = null
    },

    get(key) {
      const row = db.query('SELECT offset FROM idx WHERE key = ?').get(key)
      return row ? row.offset : undefined
    },

    put(key, offset) {
      db.run(
        'INSERT INTO idx (key, offset) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET offset=excluded.offset',
        [key, offset]
      )
    },

    del(key) {
      db.run('DELETE FROM idx WHERE key = ?', [key])
    },

    * range(lo, hi) {
      const rows = db.query('SELECT key, offset FROM idx WHERE key >= ? AND key <= ? ORDER BY key').all(lo, hi)
      for (const r of rows) yield [r.key, r.offset]
    },

    rebuild(fromOffset, records) {
      db.run('DELETE FROM idx WHERE 1=1')
      db.run('BEGIN')
      try {
        for (const { key, offset } of records) this.put(key, offset)
        db.run('COMMIT')
      } catch (e) {
        db.run('ROLLBACK')
        throw e
      }
    }
  }
}
