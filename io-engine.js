import {
  existsSync, readFileSync, writeFileSync, appendFileSync,
  openSync, fstatSync, readSync, closeSync, unlinkSync,
  statSync, mkdirSync, renameSync, readdirSync
} from 'fs'
// openSync/fstatSync/readSync/closeSync retained for syncFrom incremental read
import { dirname, basename, join } from 'path'
import { stringify } from 'yaml'
import { EMIT, ON, OFF, TRANSITION } from '../../utils/src/bus.js'
import { makeFullKey, shortestPrefix, verify, toBits, toB64 } from '../hash.js'

/**
 * io-engine.js — IO Primitive
 *
 * Dual-format .dash files:
 *   dash (default):  {payload}#key
 *   jsonl:           {"key":payload}
 *
 * Lock protocol (yaml rename):
 *   free    → f.yaml exists
 *   locked  → f.yaml renamed to f.yaml.<PID>
 *   acquire → renameSync(f.yaml, f.yaml.<PID>)  — atomic on POSIX, ENOENT if already locked
 *   release → write f.yaml.tmp, renameSync to f.yaml, unlinkSync(lockPath)
 *   error   → renameSync(lockPath, f.yaml)       — restores old projection
 *   stale   → scan for f.yaml.<pid>, kill(pid,0) to check liveness, steal if dead
 *
 * Write path:
 *   in(payload)            — buffer + flush immediately (default, backward-compat)
 *   in(payload,{flush:0})  — buffer only; explicit flush() later
 *   flush()                — pre-compute outside lock, acquire, verify chain,
 *                            write batch in one appendFileSync, release
 */


function acquireLock(f, timeout = 1000) {
  const deadline = Date.now() + timeout
  const myLock = `${f.yaml}.${process.pid}`
  while (Date.now() < deadline) {
    try {
      renameSync(f.yaml, myLock)
      return myLock   // acquired
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
    // .yaml is gone — another process holds the lock; check for stale
    const dir = dirname(f.yaml), base = basename(f.yaml) + '.'
    try {
      for (const file of readdirSync(dir)) {
        if (!file.startsWith(base)) continue
        const pid = parseInt(file.slice(base.length))
        if (!pid) continue
        try { process.kill(pid, 0) } catch {
          // dead process — steal its lock
          try { renameSync(join(dir, file), myLock); return myLock } catch { }
        }
      }
    } catch { }
  }
  throw new Error(`[IO] Lock timeout (${timeout}ms): ${f.yaml}`)
}

function parseLine(line) {
  if (!line || typeof line !== 'string') return null
  line = line.trim()
  if (!line) return null
  const hi = line.lastIndexOf('#')
  if (hi > 0 && line[0] === '{') {
    const key = line.slice(hi + 1).trim()
    if (key && !/[{}\s]/.test(key)) {
      try { return { [key]: JSON.parse(line.slice(0, hi)) } } catch { }
    }
  }
  try { return JSON.parse(line) } catch { return null }
}

function serializeLine(key, payload, format) {
  if (format === 'jsonl') return JSON.stringify({ [key]: payload })
  return JSON.stringify(payload) + '#' + key
}


export function IO(base, { reduce, initial, log: logOverride, type, entity, format: fmt } = {}) {
  const name = entity ?? basename(base), entityType = type ?? 'kv'
  const format = fmt || 'dash'
  const hasExt = /\.[a-z0-9]+$/i.test(base)
  const f = {
    dash:  logOverride || (hasExt ? base : base + '.dash'),
    yaml:  logOverride ? logOverride.replace(/\.dash$/, '.yaml')
                       : (hasExt ? base.replace(/\.[a-z0-9]+$/i, '') : base) + '.yaml',
    index: logOverride ? logOverride.replace(/\.dash$/, '.index')
                       : (hasExt ? base.replace(/\.[a-z0-9]+$/i, '') : base) + '.index',
  }

  const _reduce  = reduce  ?? ((acc, rec) => Object.assign({}, acc, Object.values(rec)[0] ?? {}))
  const _initial = initial ?? (Array.isArray(initial) ? [] : {})

  let projection = Array.isArray(_initial) ? [] : { ..._initial }
  let lastOffset = 0
  let flushCount = 0
  let genesisWritten = false
  let idx = {
    records: new Set(), prefixSet: new Set(),
    shortMap: new Map(), hashMap: new Map(),
    levels: {}, recordCount: 0,
    lastKey: null,
  }
  let _log = []          // buffered payloads not yet on disk
  let _sessionRecs = []  // all records written this session (for fast settle checks)

  function saveIndex() {
    if (!f.index) return
    // Header: lastKey + lastOffset allow fast-open (delta sync from this point)
    // prefixes: full prefixSet bits needed to avoid key collisions on next append
    let out = `lastKey=${idx.lastKey || ''}\nlastOffset=${lastOffset}\n`
    if (idx.prefixSet.size > 0) out += `prefixes=${[...idx.prefixSet].join(',')}\n`
    for (const [lvl, d] of Object.entries(idx.levels))
      out += `${lvl}${JSON.stringify({ count: d.count })}\n`
    const tmp = f.index + '.tmp'
    writeFileSync(tmp, out); renameSync(tmp, f.index)
  }

  // Incremental read: only bytes since `offset`
  function syncFrom(offset) {
    if (!existsSync(f.dash)) return
    const sz = statSync(f.dash).size
    if (sz <= offset) return
    const fd = openSync(f.dash, 'r')
    const buf = Buffer.alloc(sz - offset)
    readSync(fd, buf, 0, sz - offset, offset)
    closeSync(fd)
    const recs = buf.toString('utf8').split('\n').filter(Boolean).map(parseLine).filter(Boolean)
    projection = recs.reduce((acc, rec) => { try { return _reduce(acc, rec) } catch { return acc } }, projection)
    if (offset === 0) {
      idx.prefixSet.add(toBits('0')); idx.prefixSet.add(toBits('1'))
      idx.records.add('0'); idx.records.add('1')
    }
    for (const rec of recs) {
      const key = Object.keys(rec)[0], payload = rec[key]
      if (key === '0') { idx.lastKey = '0'; continue }
      if (key === '1') { idx.lastKey = '1'; continue }
      const fullKey = makeFullKey(payload, idx.lastKey)
      const bits = toBits(key)
      idx.records.add(fullKey); idx.prefixSet.add(bits)
      idx.shortMap.set(key, fullKey); idx.shortMap.set(fullKey, fullKey)
      idx.hashMap.set(fullKey, payload)
      ;(idx.levels[bits.length] ?? (idx.levels[bits.length] = { count: 0 })).count++
      idx.lastKey = key
      idx.recordCount++
      _sessionRecs.push(rec)  // accumulate so callers can skip disk re-reads
    }
    lastOffset = sz
    genesisWritten = true
  }

  // Provisional key computation — uses a local copy of prefixSet, no side-effects.
  // Single-record fast path skips the Set copy entirely.
  function computeKeys(log, prevKey) {
    if (log.length === 1) {
      const payload = log[0], fullKey = makeFullKey(payload, prevKey)
      const short = shortestPrefix(fullKey, idx.prefixSet)
      return [{ fullKey, short, line: serializeLine(short.p, payload, format) + '\n', payload, prevKey }]
    }
    const localSet = new Set(idx.prefixSet)
    let prevK = prevKey
    return log.map(payload => {
      const pk = prevK
      const fullKey = makeFullKey(payload, prevK)
      const short = shortestPrefix(fullKey, localSet)
      localSet.add(short.bits)
      prevK = short.p
      return { fullKey, short, line: serializeLine(short.p, payload, format) + '\n', payload, prevKey: pk }
    })
  }

  function writeGenesis(initPayload) {
    const p0 = initPayload ?? { _entity: name, _type: entityType }
    const p1 = { _projection: name }
    if (!existsSync(dirname(f.dash))) mkdirSync(dirname(f.dash), { recursive: true })
    appendFileSync(f.dash, serializeLine('0', p0, format) + '\n')
    appendFileSync(f.dash, serializeLine('1', p1, format) + '\n')
    projection = _reduce(_reduce(Array.isArray(_initial) ? [] : { ..._initial }, { '0': p0 }), { '1': p1 })
    const tmp = f.yaml + '.tmp'
    writeFileSync(tmp, stringify(projection, { collectionStyle: 'block' })); renameSync(tmp, f.yaml)
    saveIndex()
    idx.prefixSet.add(toBits('0')); idx.prefixSet.add(toBits('1'))
    idx.records.add('0'); idx.records.add('1')
    idx.shortMap.set('0', '0'); idx.shortMap.set('1', '1')
    idx.lastKey = '1'
    lastOffset = statSync(f.dash).size
    genesisWritten = true
  }

  function flushYaml(projection, myLock) {
    const yamlStr = stringify(projection, { collectionStyle: 'block' })
    writeFileSync(f.yaml + '.tmp', yamlStr)
    saveIndex()                              // still inside lock window
    renameSync(f.yaml + '.tmp', f.yaml)     // release lock
    try { unlinkSync(myLock) } catch { }
  }

  function flush() {
    if (_log.length === 0) return []
    if (!genesisWritten) writeGenesis()

    // ── Pre-compute outside lock ─────────────────────────────────────────────
    let prevKey = idx.lastKey
    let provisional = computeKeys(_log, prevKey)
    const _projCopy = () => Array.isArray(projection) ? [...projection] : { ...projection }
    let newProjection = provisional.reduce(
      (acc, { short, payload }) => _reduce(acc, { [short.p]: payload }), _projCopy()
    )
    let allBytes = Buffer.from(provisional.map(p => p.line).join(''))

    // ── Acquire lock (spin ≤ 1000ms) ─────────────────────────────────────────
    const myLock = acquireLock(f)

    try {
      // ── Verify chain: re-compute if another writer got in (size check only) ─
      if (statSync(f.dash).size !== lastOffset) {
        syncFrom(lastOffset)
        prevKey = idx.lastKey
        provisional = computeKeys(_log, prevKey)
        newProjection = provisional.reduce(
          (acc, { short, payload }) => _reduce(acc, { [short.p]: payload }), { ...projection }
        )
        allBytes = Buffer.from(provisional.map(p => p.line).join(''))
      }

      // ── Append log ────────────────────────────────────────────────────────
      appendFileSync(f.dash, allBytes)
      lastOffset += allBytes.length

      // ── Update in-memory state ────────────────────────────────────────────
      projection = newProjection
      for (const { short, fullKey, payload } of provisional) {
        const bits = short.bits
        idx.prefixSet.add(bits); idx.records.add(fullKey)
        idx.shortMap.set(short.p, fullKey); idx.shortMap.set(fullKey, fullKey)
        idx.hashMap.set(fullKey, payload)
        ;(idx.levels[bits.length] ?? (idx.levels[bits.length] = { count: 0 })).count++
        idx.lastKey = short.p
        idx.recordCount++
        _sessionRecs.push({ [short.p]: payload })
      }
      _log = []

      // ── Release lock BEFORE emitting — prevents re-entrant lock deadlock ─
      if (++flushCount % 100 === 0) {
        flushYaml(projection, myLock)   // saves yaml + index (inside lock window)
      } else {
        renameSync(myLock, f.yaml)
        saveIndex()                     // always persist index so open() can fast-path
      }

      // ── Emit after lock released so handlers can write without deadlock ──
      for (const { short, fullKey, payload } of provisional) {
        EMIT(`io:${name}`, { key: short.p, fullKey, payload })
        TRANSITION('io:write', { entity: name, key: short.p, payload })
      }
    } catch (e) {
      if (!existsSync(f.yaml)) try { renameSync(myLock, f.yaml) } catch { }
      throw e
    }

    return provisional.map(p => '#' + p.short.p)
  }

  // in(payload) — flush:true keeps backward-compatible '#key' return
  function write(payload, { flush: doFlush = true } = {}) {
    _log.push(payload)
    if (doFlush) {
      const keys = flush()
      return keys[keys.length - 1]   // '#key' for this payload
    }
  }

  function get(ref) {
    if (ref === '#0' || ref === 0) {
      if (!existsSync(f.dash)) return undefined
      const first = parseLine(readFileSync(f.dash, 'utf8').split('\n')[0])
      return first ? Object.values(first)[0] : undefined
    }
    if (ref === '#1' || ref === 1 || ref == null) return projection
    const s = String(ref), isHash = s.startsWith('#'), p = isHash ? s.slice(1) : s
    if (projection && typeof projection === 'object' && !Array.isArray(projection) && p in projection) return projection[p]
    const full = idx.shortMap.get(p) || p
    if (projection && typeof projection === 'object' && !Array.isArray(projection) && full in projection) return projection[full]
    if (isHash) {
      if (idx.hashMap.has(full)) return idx.hashMap.get(full)
      if (idx.hashMap.has(p))    return idx.hashMap.get(p)
      const match = recs().find(r => { const k = Object.keys(r)[0]; return k === p || k === full })
      if (match) return Object.values(match)[0]
    }
    return undefined
  }

  const recs = () => existsSync(f.dash)
    ? readFileSync(f.dash, 'utf8').split('\n').filter(Boolean).map(parseLine).filter(Boolean)
    : []

  return {
    open(initPayload) {
      if (!existsSync(dirname(f.dash))) mkdirSync(dirname(f.dash), { recursive: true })
      // Race-safe genesis: exclusive-create .yaml as the once-only mutex.
      // First caller wins and writes genesis; losers spin until free state then sync.
      if (!existsSync(f.dash) || statSync(f.dash).size === 0) {
        try {
          closeSync(openSync(f.yaml, 'wx'))   // atomic exclusive create — winner only
          writeGenesis(initPayload)
        } catch (e) {
          if (e.code !== 'EEXIST') throw e
          // Another process is writing genesis — wait for free state then sync
          const deadline = Date.now() + 5000
          while (Date.now() < deadline) {
            if (existsSync(f.dash) && statSync(f.dash).size > 0 && existsSync(f.yaml)) break
          }
          syncFrom(0)
        }
      } else {
        // ponytail: index's lastOffset/lastKey track the raw append position, not
        // the (possibly stale, only-every-100th-flush) yaml snapshot — a fresh
        // process's empty `projection` can't safely delta-sync from that offset.
        // Full rebuild from the dash log instead; upgrade to real delta-sync if
        // profiling shows open() cost matters for large logs.
        syncFrom(0)
        if (!existsSync(f.yaml)) {
          const tmp = f.yaml + '.tmp'
          writeFileSync(tmp, stringify(projection, { collectionStyle: 'block' }))
          renameSync(tmp, f.yaml)
          saveIndex()
        }
        genesisWritten = true
      }
    },
    close() {
      if (_log.length) flush()
      // Flush pending yaml/index if not already up-to-date
      if (flushCount % 100 !== 0 && existsSync(f.dash)) {
        const myLock = acquireLock(f)
        try { flushYaml(projection, myLock) } catch { try { renameSync(myLock, f.yaml) } catch { } }
      }
    },
    in: write,
    flush,
    get,
    out:     (h) => { ON(`io:${name}`, h); return () => OFF(`io:${name}`, h) },
    records: recs,
    sessionRecords: () => _sessionRecs,
    verify:  () => verify(recs()),
    header:  () => get('#0'),
    state:   () => get('#1'),
    find:    (pred) => recs().map(r => Object.values(r)[0]).filter(pred),
    get size() { return idx.recordCount },
    family: f,
    path:    () => f.dash,
  }
}

export const merge = (acc, rec) => {
  let p = Object.values(rec)[0]
  if (!p || typeof p !== 'object') p = rec
  for (const [k, v] of Object.entries(p)) {
    if (v === null) delete acc[k]
    else if (typeof v === 'object' && !Array.isArray(v)) acc[k] = { ...(acc[k] ?? {}), ...v }
    else acc[k] = v
  }
  return acc
}
export const append = (acc, rec) => (acc ?? []).push ? (acc.push(rec), acc) : [rec]
export const assign = (acc, rec) => Object.assign({}, acc, Object.values(rec)[0] ?? {})

export { verify, makeFullKey, sha64 } from '../hash.js'

export default IO
