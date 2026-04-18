/**
 * io/adapters/env.js — .env file KV collection (v20.21)
 */

import { readFileSync, writeFileSync, existsSync, watch, statSync } from 'fs'

function parse(text) {
  const result = {}
  
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const key = t.slice(0, eq).trim()
    let val   = t.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    result[key] = val
  }
  return result
}

function serialize(data) {
  return Object.entries(data).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
}

export function EnvCollection(filePath) {
  let cache    = null
  let handlers = []

  const load  = () => {
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) return {}
    try { return parse(readFileSync(filePath, 'utf8')) } catch { return {} }
  }
  const live  = () => { if (cache === null) cache = load(); return cache }
  const emit  = (payload) => handlers.forEach(h => h({ key: '*', payload }))

  let watcher = null

  const col = {
    open() {
      cache = load()
      if (filePath && existsSync(filePath) && statSync(filePath).isFile()) {
        try {
          watcher = watch(filePath, { persistent: false }, () => { cache = load(); emit(cache) })
        } catch { } 
      }
      return col
    },
    close() { watcher?.close(); watcher = null },

    get(key) {
      if (key === undefined || key === null || key === '#1') return live()
      if (key === '#0') return { _entity: filePath ?? '.env', _type: 'env', _created: 0 }
      return live()[String(key)]
    },
    in(patch) {
      if (!filePath) return col
      const next = { ...load(), ...patch }
      writeFileSync(filePath, serialize(next))
      cache = next; emit(next); return col
    },
    out(handler) {
      handlers.push(handler)
      return () => { handlers = handlers.filter(h => h !== handler) }
    },
    flush: () => {}, 
    records: () => [],
    verify:  () => ({ valid: true, length: 0 }),
    find:    (pred) => Object.entries(live()).filter(([, v]) => pred(v)),
    header:  () => ({ _entity: filePath ?? '.env', _type: 'env', _created: 0 }),
    state:   () => live(),
    get size() { return Object.keys(live()).length },
    type: 'env',
    path: () => filePath,
    hasChildren: () => false
  }

  return new Proxy(col, {
    get(t, k) {
      if (typeof k === 'symbol') return t[k]
      if (Object.prototype.hasOwnProperty.call(t, k) || typeof t[k] === 'function') return t[k]
      const desc = Object.getOwnPropertyDescriptor(t, k)
      if (desc && desc.get) return t[k]
      return t.get(String(k))
    },
    set(t, k, v) { if (k in t) { t[k] = v; return true }; t.in({ [k]: v }); return true },
  })
}

export const extensions = ['env']
export default EnvCollection
