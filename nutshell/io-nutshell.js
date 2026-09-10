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
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync } from 'fs'
// adapters
import json from './io-json'
import yaml from './io-yaml'
// hash keys
import { toBits, makeFullKey, shortestPrefix, verify } from './io-hash'
// shared critical section (io-engine.js uses the same module)
import { appendGuarded, ensureLock } from '../src/adapters/io-append.js'

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
    // Coordinated writes, off by default. Without it this engine is exactly
    // what the doc says it is: no locks, no WAL, no fsync. With it, writes go
    // through the same critical section io-engine.js uses (io-append.js).
    lock = false,
  } = opts

  const projExt = projection.ext || '.json'
  const logExt = log.ext || '.jsonl'
  const projTo = projection.to || json.to
  const projFrom = projection.from || json.from

  const logFile = join(path, name + logExt)
  const projFile = join(path, name + projExt)
  // A dedicated 0-byte mutex, never the projection: the projection is derived
  // and now published outside the lock, so it cannot also be the lock.
  const lockFile = join(path, name + '.lock')

  const logSize = () => { try { return statSync(logFile).size } catch { return 0 } }

  const clone = v => Array.isArray(v) ? [...v] : { ...v }
  let state = clone(initial)
  let buffer = []
  let subs = new Set()
  let prevKey = null
  let recordCount = 0
  let prefixSet = new Set()
  let hashMap = new Map()   // fullKey → payload (O(1) lookup)
  // Log size our in-memory chain reflects. In locked mode this is what tells
  // appendGuarded whether anyone appended behind our back — a fresh statSync
  // would not: it would read the log AFTER the other writer landed and match.
  let loadedOffset = 0

  // ── Core ───────────────────────────────────────────────────────

  // Replay the log into prevKey/prefixSet/hashMap. Used at bootstrap and, in
  // locked mode, again when another writer got in ahead of us.
  function loadFrom(recs) {
    for (const { key, payload } of recs) {
      state = reduce(state, payload)
      prefixSet.add(toBits(key))
      if (key === '0' || key === '1') { prevKey = key; continue }
      const full = makeFullKey(payload, prevKey)
      hashMap.set(full, payload)
      hashMap.set(key, payload)
      prevKey = key
      recordCount++
    }
  }

  const readRecords = () => existsSync(logFile)
    ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(parseLine).filter(Boolean)
    : []

  // The mutex is created once, at construction — never inside flush(). A
  // process that finds it missing mid-flush would be looking at a lock someone
  // else is HOLDING (acquire renames it away), and recreating it would let two
  // writers in at once. That is the same coupling feature 2.3 removes from
  // io-engine, where the projection doubles as the lock.
  if (lock) {
    try { if (!existsSync(path)) mkdirSync(path, { recursive: true }) } catch { }
    // Created once, at construction, via exclusive-create. Never behind an
    // existsSync guard: while another process holds the lock the file is
    // renamed away, so the guard would recreate the mutex mid-hold and let two
    // writers into the critical section. See ensureLock's comment.
    ensureLock(lockFile)
  }

  // ── Bootstrap: replay log, fallback to projection ──────────────
  if (existsSync(logFile)) { loadFrom(readRecords()); loadedOffset = logSize() }
  else if (existsSync(projFile)) {
    try { state = projFrom(readFileSync(projFile, 'utf8')) } catch { }
  }

  // Chain the buffered payloads onto whatever prevKey currently is. Separate
  // from flush() because locked mode may have to run it twice: once
  // speculatively, once more against the log another writer just extended.
  function chain() {
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
    return { flushed, text: lines.join('') }
  }

  function writeGenesis() {
    if (existsSync(logFile) && readFileSync(logFile, 'utf8').length > 0) return
    const g0 = { _entity: name, _type: 'io' }
    const g1 = { _projection: name }
    appendFileSync(logFile, formatLine('0', g0) + '\n' + formatLine('1', g1) + '\n')
    prefixSet.add('0'); prefixSet.add('1')
    prevKey = '1'
  }

  function flush() {
    if (!buffer.length) return []
    if (!existsSync(path)) mkdirSync(path, { recursive: true })

    let flushed
    if (!lock) {
      // Default path — byte for byte what it always was. No locks, no WAL, no
      // fsync: concurrent writers keep every record but break the chain, which
      // io-nutshell.concurrency.test.js measures rather than hides.
      writeGenesis()
      const c = chain()
      appendFileSync(logFile, c.text)
      loadedOffset = logSize()
      flushed = c.flushed
    } else {
      // Coordinated path — opt in. The critical section is shared with
      // io-engine.js via io-append.js: check the log grew, append, release.
      let c
      const guarded = appendGuarded({
        lockFile,
        logFile,
        lastOffset: loadedOffset,
        // Another writer appended while we were computing: drop the keys we
        // speculated, replay what actually landed, and re-chain onto it.
        onResync: () => {
          prefixSet = new Set(); hashMap = new Map()
          prevKey = null; recordCount = 0
          state = clone(initial)
          loadFrom(readRecords())
          loadedOffset = logSize()
          for (const payload of buffer) state = reduce(state, payload)
        },
        compute: ({ resynced }) => {
          // Genesis is part of the guarded write: elected under the lock, and
          // re-checked on resync in case the winner was someone else.
          let head = ''
          if (!existsSync(logFile) || logSize() === 0) {
            const g0 = { _entity: name, _type: 'io' }
            const g1 = { _projection: name }
            head = formatLine('0', g0) + '\n' + formatLine('1', g1) + '\n'
            prefixSet.add('0'); prefixSet.add('1')
            prevKey = '1'
          }
          c = chain()
          return { bytes: Buffer.from(head + c.text) }
        },
      })
      loadedOffset = guarded.offset
      flushed = guarded.result ?? c.flushed
    }

    // Projection is DERIVED — recomputable from the log — so it is published
    // outside the critical section. That is the whole point of feature 2.2.
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
