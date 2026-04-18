/**
 * io/adapters/50-sqlite.js — Minimal but powerful SQLite adapter for Bun
 */
import { Database } from 'bun:sqlite'
import { existsSync } from 'fs'
import { dirname } from 'path'
import { mkdirSync } from 'fs'

export function SqliteCollection(filePath, opts = {}) {
  let db = null

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

    /** Reactive Interface Compatibility */
    get(k) {
      if (!db) this.open()
      // Heuristic: if k is a table name, return all
      try {
        return db.query(`SELECT * FROM ${k}`).all()
      } catch {
        return undefined
      }
    },

    in(patch) {
      if (!db) this.open()
      // Map patches to inserts if they look like { table: row }
      for (const [table, row] of Object.entries(patch)) {
        if (typeof row === 'object' && row !== null) {
          const keys = Object.keys(row)
          const vals = Object.values(row)
          const placeholders = keys.map(() => '?').join(', ')
          const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
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
       // Count tables
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
