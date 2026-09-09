import {
  existsSync, readFileSync, writeFileSync, appendFileSync,
  openSync, fstatSync, readSync, closeSync, unlinkSync,
  statSync, mkdirSync, renameSync, readdirSync
} from 'fs'
// openSync/fstatSync/readSync/closeSync retained for syncFrom incremental read
import { dirname, basename, join } from 'path'
import { stringify } from 'yaml'
import { EMIT, ON, OFF, TRANSITION } from '../utils/src/bus.js'
import { makeFullKey, shortestPrefix, verify, toBits, toB64 } from './hash.js'
import { acquireLock, releaseLock, publishDerived, LOCK_TIMEOUT } from './io-append.js'

/**
 * io-engine.js — IO Primitive
 *
 * Dual-format .dash files:
 *   dash (default):  {payload}#key
 *   jsonl:           {"key":payload}
 *
 * Lock protocol (dedicated lockfile, feature 2.3 — see io-append.js):
 *   the mutex is f.lock, and ABSENCE means free:
 *     free    → no f.lock.* exists
 *     locked  → f.lock.<PID> exists (created with 'wx', atomic)
 *     release → unlink it
 *   Nothing has to create the mutex first, because "no file" is already the
 *   free state. f.yaml is now a plain derived artifact, like f.index: always
 *   present, published from outside the critical section, arbitrated by offset.
 *
 * Write path:
 *   in(payload)            — buffer + flush immediately (default, backward-compat)
 *   in(payload,{flush:0})  — buffer only; explicit flush() later
 *   flush()                — pre-compute outside lock, acquire, verify chain,
 *                            write batch in one appendFileSync, release
 */


// The lock protocol itself now lives in io-append.js — one implementation shared by
// this engine and the nutshell's, instead of two copies drifting apart. What used to
// live here was a `lockTimeout` that GREW with the size of f.yaml. It grew because the
// work under the lock grew: `flush` rewrote the whole projection inside the critical
// section, so a bigger store genuinely needed longer before declaring a deadlock.
//
// Feature 2.2 moved that O(n) work out, and 2.1 measured what was left. With the
// critical section down to *stat, append, release*, a timeout that scales with the
// store compensates for nothing — so it is a flat constant again (LOCK_TIMEOUT), and
// the constant is justified by the measurement rather than picked by hand.

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


export function IO(base, { reduce, initial, log: logOverride, type, entity, format: fmt, bench } = {}) {
  const name = entity ?? basename(base), entityType = type ?? 'kv'
  const format = fmt || 'dash'
  const hasExt = /\.[a-z0-9]+$/i.test(base)
  const f = {
    dash:  logOverride || (hasExt ? base : base + '.dash'),
    yaml:  logOverride ? logOverride.replace(/\.dash$/, '.yaml')
                       : (hasExt ? base.replace(/\.[a-z0-9]+$/i, '') : base) + '.yaml',
    index: logOverride ? logOverride.replace(/\.dash$/, '.index')
                       : (hasExt ? base.replace(/\.[a-z0-9]+$/i, '') : base) + '.index',
    // The mutex, feature 2.3. Zero bytes, forever — it carries no data at all,
    // which is the entire point: nothing reads it, so nothing depends on it
    // being present, so it is free to spend its life renamed away to
    // `.lock.<pid>` while a writer holds it.
    lock:  logOverride ? logOverride.replace(/\.dash$/, '.lock')
                       : (hasExt ? base.replace(/\.[a-z0-9]+$/i, '') : base) + '.lock',
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

  // Read the lastOffset another writer recorded in the index on disk. Cheap:
  // it is the second line of the header, so a partial read would do — kept
  // simple until profiling says otherwise.
  function indexOffsetOnDisk() {
    if (!f.index || !existsSync(f.index)) return null
    try {
      const head = readFileSync(f.index, 'utf8').slice(0, 200)
      const m = head.match(/lastOffset=(\d+)/)
      return m ? Number(m[1]) : null
    } catch { return null }
  }

  function saveIndex() {
    if (!f.index) return
    // ORDER ARBITER (feature 2.2). The index is now published OUTSIDE the lock,
    // so two writers can reach this point out of order and a slow one can land
    // after a fast one — an older index overwriting a newer. Only publish if we
    // are at least as far along as what is already on disk.
    //
    // This is safe precisely because the index is a HINT, not truth: skipping a
    // write costs a slightly stale hint, while clobbering costs a wrong one.
    const onDisk = indexOffsetOnDisk()
    if (onDisk != null && onDisk > lastOffset) return

    // Header: lastKey + lastOffset allow fast-open (delta sync from this point)
    // prefixes: full prefixSet bits needed to avoid key collisions on next append
    let out = `lastKey=${idx.lastKey || ''}\nlastOffset=${lastOffset}\n`
    if (idx.prefixSet.size > 0) out += `prefixes=${[...idx.prefixSet].join(',')}\n`
    for (const [lvl, d] of Object.entries(idx.levels))
      out += `${lvl}${JSON.stringify({ count: d.count })}\n`
    // PID-suffixed temp: the fixed `.index.tmp` name was shared across every
    // process writing this base, so concurrent writers clobbered each other's
    // temp mid write→rename (ENOENT on rename, or a silently corrupt index).
    // A private temp + atomic rename is collision-free on POSIX.
    const tmp = `${f.index}.${process.pid}.tmp`
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
    // PID-suffixed temp, for the same reason the index has one: a fixed `.tmp`
    // is shared by every process writing this base, and they clobber each other
    // mid write->rename. That was the bug 1.2 fixed for the index; it must not
    // come back through the projection's door.
    const tmp = `${f.yaml}.${process.pid}.tmp`
    writeFileSync(tmp, stringify(projection, { collectionStyle: 'block' })); renameSync(tmp, f.yaml)
    saveIndex()
    idx.prefixSet.add(toBits('0')); idx.prefixSet.add(toBits('1'))
    idx.records.add('0'); idx.records.add('1')
    idx.shortMap.set('0', '0'); idx.shortMap.set('1', '1')
    idx.lastKey = '1'
    lastOffset = statSync(f.dash).size
    genesisWritten = true
  }

  // Publish the YAML projection. No lock — this is feature 2.3's payoff.
  //
  // Under 2.2 this function had to REACQUIRE the lock just to do its final
  // rename, because f.yaml was simultaneously the projection and the mutex:
  // writing it while another process held the lock would forge a second mutex
  // and put two writers in the critical section at once. (Measured on the
  // nutshell's lock: create-while-held put 8 of 120 sections in overlap.)
  //
  // With the mutex moved to its own f.lock, that constraint is simply gone. The
  // projection is now an ordinary derived artifact, exactly like the index, and
  // it publishes the same way: write a private temp, rename, and let the offset
  // arbiter decide who wins when two writers race.
  //
  // The arbiter reads the INDEX's offset rather than the yaml's, because YAML
  // has nowhere to put one — it is the user-facing projection, not a container
  // for our bookkeeping. Both files are published from the same `lastOffset` in
  // the same pass, so the index's recorded offset is a faithful stand-in for how
  // current the projection on disk is.
  function publishYaml() {
    const yamlStr = stringify(projection, { collectionStyle: 'block' })   // O(n), no lock held
    publishDerived({
      file: f.yaml,
      content: yamlStr,
      offset: lastOffset,
      readOffset: () => indexOffsetOnDisk(),
    })
  }

  // Kept for close(), which publishes while already holding the lock. Releasing
  // is now a separate, explicit act: it used to be a side effect of renaming the
  // projection into place, because that rename WAS the release. With a dedicated
  // mutex the two are independent, and saying so costs one line.
  function flushYaml(projection, myLock) {
    const yamlStr = stringify(projection, { collectionStyle: 'block' })
    const tmp = `${f.yaml}.${process.pid}.tmp`
    writeFileSync(tmp, yamlStr)
    saveIndex()
    renameSync(tmp, f.yaml)
    releaseLock(myLock, f.lock)
  }

  function flush() {
    if (_log.length === 0) return []
    if (!genesisWritten) writeGenesis()

    // Phase instrumentation: zero cost unless `bench` was passed to IO(). Each
    // `t.*` is a monotonic mark in ms; `bench(t)` gets the raw marks and does
    // its own subtraction, so this stays a handful of `Date.now()` calls with
    // no allocation on the cold path.
    const t = bench ? { precomputeStart: Date.now() } : null

    // ── Pre-compute outside lock ─────────────────────────────────────────────
    let prevKey = idx.lastKey
    let provisional = computeKeys(_log, prevKey)
    const _projCopy = () => Array.isArray(projection) ? [...projection] : { ...projection }
    let newProjection = provisional.reduce(
      (acc, { short, payload }) => _reduce(acc, { [short.p]: payload }), _projCopy()
    )
    let allBytes = Buffer.from(provisional.map(p => p.line).join(''))
    if (t) t.precomputeEnd = Date.now()

    // ── Acquire lock (spin ≤ 1000ms) ─────────────────────────────────────────
    if (t) t.lockWaitStart = t.precomputeEnd
    const myLock = acquireLock(f.lock)
    if (t) t.lockAcquired = Date.now()   // seção crítica começa aqui

    try {
      // ── Verify chain: re-compute if another writer got in (size check only) ─
      if (t) t.verifyStatStart = Date.now()
      const resynced = statSync(f.dash).size !== lastOffset
      if (t) t.verifyStatEnd = Date.now()
      if (resynced) {
        if (t) t.recomputeStart = t.verifyStatEnd
        syncFrom(lastOffset)
        prevKey = idx.lastKey
        provisional = computeKeys(_log, prevKey)
        newProjection = provisional.reduce(
          (acc, { short, payload }) => _reduce(acc, { [short.p]: payload }), { ...projection }
        )
        allBytes = Buffer.from(provisional.map(p => p.line).join(''))
        if (t) t.recomputeEnd = Date.now()
      }

      // ── Append log ────────────────────────────────────────────────────────
      if (t) t.appendStart = Date.now()
      appendFileSync(f.dash, allBytes)
      lastOffset += allBytes.length
      if (t) t.appendEnd = Date.now()

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

      // ── Release the lock NOW (feature 2.2) ───────────────────────────────
      // The indivisible work is done: we checked the log had not grown, and we
      // appended. Everything below this line publishes DERIVED state — the
      // index and the YAML projection are both reconstructible from the .dash —
      // so holding the lock across it buys nothing and costs everything.
      //
      // That cost was measured (baseline 2.1): the critical section went from
      // p99=17ms at 1k records to 733ms at 100k, and in 100k×8 seven of eight
      // workers hit the lock timeout. `stringify` of a 100k projection alone is
      // ~790ms, and it ran with the lock held.
      const yieldFlush = ++flushCount % 100 === 0
      releaseLock(myLock, f.lock)       // release: rename the mutex back, nothing else
      if (t) t.lockReleased = Date.now()   // seção crítica termina aqui

      // ── Publish derived state, lock released ─────────────────────────────
      if (t) t.publishStart = t.lockReleased
      saveIndex()                       // arbitrated by lastOffset (see saveIndex)
      if (yieldFlush) publishYaml()

      // ── Emit after lock released so handlers can write without deadlock ──
      for (const { short, fullKey, payload } of provisional) {
        EMIT(`io:${name}`, { key: short.p, fullKey, payload })
        TRANSITION('io:write', { entity: name, key: short.p, payload })
      }
    } catch (e) {
      // Put the mutex back. Under the old protocol this branch had to guess:
      // the lock and the projection were the same file, so restoring one could
      // resurrect a stale copy of the other, and the `existsSync` guard was
      // there to avoid overwriting a projection a different writer had already
      // published. With a dedicated 0-byte mutex there is no such ambiguity —
      // releasing is unconditional, and it must happen or every other writer
      // waits out the full timeout for a lock nobody holds.
      try { releaseLock(myLock, f.lock) } catch { }
      throw e
    }

    if (t) bench(t)
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

      // No mutex to create. Under presence-semantics the free state is "no
      // f.lock.* on disk", which a fresh directory already satisfies — so the
      // once-only birth ceremony this line used to perform, and the whole class
      // of bug that came with getting it wrong, are simply gone. See the
      // protocol note at the top of io-append.js.

      if (!existsSync(f.dash) || statSync(f.dash).size === 0) {
        // Genesis under the ordinary lock. This used to need a protocol of its
        // own — exclusive-create f.yaml as a one-shot mutex, winner writes
        // genesis, losers spin on a compound condition waiting for the data to
        // appear. All of that existed because the projection and the mutex were
        // the same file, so the file's birth and the lock's birth were the same
        // event and had to be raced together.
        //
        // Now they are separate files. The lock already exists, so genesis is
        // just the first write like any other: take the lock, look again (the
        // winner may have finished while we waited), write or sync.
        const myLock = acquireLock(f.lock)
        try {
          if (!existsSync(f.dash) || statSync(f.dash).size === 0) writeGenesis(initPayload)
          else syncFrom(0)
        } finally {
          try { releaseLock(myLock, f.lock) } catch { }
        }
      } else {
        // ponytail: index's lastOffset/lastKey track the raw append position, not
        // the (possibly stale, only-every-100th-flush) yaml snapshot — a fresh
        // process's empty `projection` can't safely delta-sync from that offset.
        // Full rebuild from the dash log instead; upgrade to real delta-sync if
        // profiling shows open() cost matters for large logs.
        syncFrom(0)
        // The ~30-line rebuild-f.yaml-under-the-lock dance that stood here is
        // gone. It handled "f.yaml is transiently missing because someone holds
        // the lock" — a state that can no longer occur, because holding the lock
        // renames f.lock, not f.yaml. The projection is always on disk now.
        genesisWritten = true
      }
    },
    close() {
      if (_log.length) flush()
      // Flush pending yaml/index if not already up-to-date
      if (flushCount % 100 !== 0 && existsSync(f.dash)) {
        const myLock = acquireLock(f.lock)
        try { flushYaml(projection, myLock) } catch { try { releaseLock(myLock, f.lock) } catch { } }
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

export { verify, makeFullKey, sha64 } from './hash.js'

export default IO
