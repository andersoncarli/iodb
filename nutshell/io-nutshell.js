/**
 * io-nutshell.js — Ultra-lean IO primitive with progressive hashing
 *
 * Two files, one interface:
 *   .jsonl  — append-only log (source of truth), lines: {payload}#key
 *   .json   — projection snapshot (derived cache)
 *
 * Usage:
 *   const io = IO('state', { path: './data' }) // state.{json jsonl}
 *   const off = io.out(rec => console.log(rec) ) // returns unsubscribe
 *   io.in({ name: 'alice' })         // write + auto-flush → '#key'
 *   io.in({ age: 30 }, false)        // buffer only
 *   io.flush()                       // explicit flush → ['#key', ...]
 *   io.get()                         // → { name: 'alice', age: 30 }
 *   io.get('name')                   // → 'alice'
 *   io.get('#key')                   // → payload by hash key
 *   off()
 */
import { join, extname } from 'path'
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs'
// adapters
import json from './io-json'
import yaml from './io-yaml'
// hash keys
import { toBits, makeFullKey, shortestPrefix, verify } from './io-hash'

// ── Log line format: {payload}#key ───────────────────────────────
function formatLine(key, payload) { return JSON.stringify(payload) + '#' + key }

function parseLine(line) {
  const hi = line.lastIndexOf('#')
  if (hi > 0 && line[0] === '{') {
    const key = line.slice(hi + 1).trim()
    if (key && !/[{}\s]/.test(key)) {
      try { return { key, payload: JSON.parse(line.slice(0, hi)) } } catch { }
    }
  }
  try { const o = JSON.parse(line); const k = Object.keys(o)[0]; return { key: k, payload: o[k] } } catch { }
  return null
}


// ── IO ───────────────────────────────────────────────────────────
export function IO(name, opts = {}) {
  const {
    path = '.',
    reduce = (acc, rec) => Object.assign({}, acc, rec),
    initial = {},
    log = { ext: '.jsonl' },
    projection = json,
  } = opts

  const projExt = projection.ext || '.json'
  const logExt = log.ext || '.jsonl'
  const projTo = projection.to || json.to
  const projFrom = projection.from || json.from

  const logFile = join(path, name + logExt)
  const projFile = join(path, name + projExt)

  const clone = v => Array.isArray(v) ? [...v] : { ...v }
  let state = clone(initial)
  let buffer = []
  let subs = new Set()
  let prevKey = null
  let recordCount = 0
  let prefixSet = new Set()
  let hashMap = new Map()   // fullKey → payload (O(1) lookup)

  // ── Bootstrap: replay log, fallback to projection ──────────────
  if (existsSync(logFile)) {
    const recs = readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(parseLine).filter(Boolean)
    for (const { key, payload } of recs) {
      state = reduce(state, payload)
      prefixSet.add(toBits(key))
      if (key === '0') { prevKey = '0'; continue }
      if (key === '1') { prevKey = '1'; continue }
      const full = makeFullKey(payload, prevKey)
      hashMap.set(full, payload)
      hashMap.set(key, payload)
      prevKey = key
      recordCount++
    }
  } else if (existsSync(projFile)) {
    try { state = projFrom(readFileSync(projFile, 'utf8')) } catch { }
  }

  // ── Core ───────────────────────────────────────────────────────

  function flush() {
    if (!buffer.length) return []
    if (!existsSync(path)) mkdirSync(path, { recursive: true })

    // Write genesis on first flush
    if (!existsSync(logFile) || readFileSync(logFile, 'utf8').length === 0) {
      const g0 = { _entity: name, _type: 'io' }
      const g1 = { _projection: name }
      appendFileSync(logFile, formatLine('0', g0) + '\n' + formatLine('1', g1) + '\n')
      prefixSet.add('0'); prefixSet.add('1')
      prevKey = '1'
    }

    const flushed = []
    const lines = []
    for (const payload of buffer) {
      const full = makeFullKey(payload, prevKey)
      const { key, bits } = shortestPrefix(full, prefixSet)
      prefixSet.add(bits)
      hashMap.set(full, payload)
      hashMap.set(key, payload)
      lines.push(formatLine(key, payload) + '\n')
      flushed.push({ key, payload })
      prevKey = key
      recordCount++
    }

    appendFileSync(logFile, lines.join(''))
    writeFileSync(projFile, projTo(state) + '\n')
    buffer = []
    for (const { key, payload } of flushed)
      for (const fn of subs) try { fn({ key, payload }) } catch { }
    return flushed.map(f => '#' + f.key)
  }

  return {
    in(record, autoFlush = true) {
      state = reduce(state, record)
      buffer.push(record)
      if (autoFlush) { const keys = flush(); return keys?.[keys.length - 1] }
      return this
    },

    out(fn) { subs.add(fn); return () => subs.delete(fn) },

    flush,

    get(ref) {
      if (ref == null) return state
      const s = String(ref)
      if (s.startsWith('#')) {
        const k = s.slice(1)
        if (hashMap.has(k)) return hashMap.get(k)
        const full = [...hashMap.keys()].find(f => typeof f === 'string' && f.startsWith(k))
        return full ? hashMap.get(full) : undefined
      }
      return state[ref]
    },

    records() {
      if (!existsSync(logFile)) return []
      return readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(parseLine).filter(Boolean)
    },

    verify() { return verify(this.records()) },
    get size() { return recordCount },
    get name() { return name },
    path: () => logFile,
  }
}

export default IO
