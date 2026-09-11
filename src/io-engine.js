import {
  existsSync, readFileSync, writeFileSync, appendFileSync,
  openSync, fstatSync, readSync, closeSync, unlinkSync,
  statSync, mkdirSync, renameSync, readdirSync
} from 'fs'
// openSync/fstatSync/readSync/closeSync retained for syncFrom incremental read
import { dirname, basename, join } from 'path'
import { stringify } from 'yaml'
import { EMIT, ON, OFF, TRANSITION } from '../../utils/src/bus.js'
import { makeFullKey, shortestPrefix, verify, toBits, toB64, nano, positionToKeyLength } from './hash.js'
import { makeBitmaps, allocKey, has as bmHas, add as bmAdd, levels as bmLevels, serialize, deserialize } from './index-bitmap.js'

/** The `.index` layout this build writes and accepts. A file carrying anything
 *  else is rebuilt from the .dash rather than guessed at. */
const INDEX_V = '0.1.0'
const INDEX_FORMAT = 'lrm-1'
import { acquireLock, releaseLock, publishDerived, LOCK_TIMEOUT } from './adapters/io-append.js'
import { PagedProjection, materialize } from './paged-projection.js'

/**
 * io-engine.js — IO Primitive
 *
 * Dual-format .dash files:
 *   dash (default):  {payload}#key
 *   jsonl:           {"key":payload}
 *
 * Lock protocol (dedicated lockfile, feature 4.3 — see io-append.js):
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
// Feature 4.2 moved that O(n) work out, and 4.1 measured what was left. With the
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


export function IO(base, { reduce, initial, log: logOverride, type, entity, format: fmt, bench, pageSize } = {}) {
  const name = entity ?? basename(base), entityType = type ?? 'kv'
  const format = fmt || 'dash'
  // Paging is one axis, like `format`: `pageSize` is a byte count, and 0 or
  // absent means "no paging" — the monolithic in-RAM projection, byte-identical
  // to every build before feature 2.5. A user of IO() needs to know exactly one
  // thing to turn it on: pass `pageSize: 4096`. The pagedtext primitive under it
  // stays importable on its own, but nobody has to reach for it.
  const _pageSize = Number(pageSize) > 0 ? Number(pageSize) : 0
  const paged = _pageSize > 0
  const hasExt = /\.[a-z0-9]+$/i.test(base)
  const f = {
    dash:  logOverride || (hasExt ? base : base + '.dash'),
    yaml:  logOverride ? logOverride.replace(/\.dash$/, '.yaml')
                       : (hasExt ? base.replace(/\.[a-z0-9]+$/i, '') : base) + '.yaml',
    index: logOverride ? logOverride.replace(/\.dash$/, '.index')
                       : (hasExt ? base.replace(/\.[a-z0-9]+$/i, '') : base) + '.index',
    // The mutex, feature 4.3. Zero bytes, forever — it carries no data at all,
    // which is the entire point: nothing reads it, so nothing depends on it
    // being present, so it is free to spend its life renamed away to
    // `.lock.<pid>` while a writer holds it.
    lock:  logOverride ? logOverride.replace(/\.dash$/, '.lock')
                       : (hasExt ? base.replace(/\.[a-z0-9]+$/i, '') : base) + '.lock',
    // The paged canonical projection (feature 2.5). Written only when
    // `pageSize > 0`; absent otherwise, exactly like a store that never asked
    // for it. `pageSize`-aligned text pages, read one page at a time, so a store
    // larger than process RAM still answers get().
    proj:  logOverride ? logOverride.replace(/\.dash$/, '.proj')
                       : (hasExt ? base.replace(/\.[a-z0-9]+$/i, '') : base) + '.proj',
  }

  const _userReduce = reduce ?? ((acc, rec) => Object.assign({}, acc, Object.values(rec)[0] ?? {}))
  const _initial = initial ?? (Array.isArray(initial) ? [] : {})
  const _pagedLayout = Array.isArray(_initial) ? 'sequential' : 'keyed'

  // The reducer contract inside the engine is "mutate acc, return acc". `merge`
  // and `append` already honour it. `assign` (the kv/map default) allocates a
  // fresh object each call — fine on the plain path, but on the paged path acc
  // is a Proxy that must not be replaced. `assign` and paged-`merge` have the
  // same observable effect (last write wins per key; merge additionally deletes
  // on null), so the paged path routes an unspecified or assign reducer through
  // an in-place shallow assign that the Proxy's set trap buffers.
  const _isAssign = !reduce || reduce.name === 'assign'
  const _reduce = paged
    ? (_isAssign
        ? (acc, rec) => {
            const p = Object.values(rec)[0] ?? {}
            for (const [k, v] of Object.entries(p)) acc[k] = v
            return acc
          }
        : _userReduce)
    : _userReduce

  // When `paged`, the projection lives in f.proj and is faced by a Proxy that
  // pages values in on demand. `_reduce` still mutates it through ordinary
  // property access — the Proxy's set/deleteProperty traps buffer the change,
  // and flushProj() writes only the pages that moved. materialize() is used
  // wherever the whole thing must become plain JSON (yaml, get('#1')).
  let projection = paged
    ? PagedProjection(f.proj, { layout: _pagedLayout, pageSize: _pageSize, initial: _initial })
    : (Array.isArray(_initial) ? [] : { ..._initial })
  let lastOffset = 0
  let flushCount = 0
  let genesisWritten = false
  let _pagedSynced = false     // paged: has this session already reconciled .proj with the log?
  let idx = {
    records: new Set(),
    // The allocator. `prefixSet`/`levels` used to be two views of this one fact,
    // kept in sync by hand at four call sites; now there is one owner.
    bitmaps: makeBitmaps(),
    shortMap: new Map(), hashMap: new Map(),
    recordCount: 0,
    lastKey: null,
    // ts of the last record this in-memory state has seen. Copied onto the
    // derived files when they publish, so each one records how current it is.
    syncedAt: null,
  }
  let _log = []          // buffered payloads not yet on disk
  let _sessionRecs = []  // all records written this session (for fast settle checks)

  // Read the lastOffset another writer recorded in the index on disk. Cheap:
  // it is in the header, so a partial read would do — kept simple until
  // profiling says otherwise.
  function indexOffsetOnDisk() {
    const h = readIndexHeader()
    return h ? h.lastOffset : null
  }

  /**
   * Parse the `.index` header without paying for the body.
   *
   * `_format` is the compatibility gate (feature 1.5): a file whose format we do
   * not recognise is not parsed at all. That costs a rebuild from the .dash,
   * which is always available and always authoritative — cheap insurance against
   * silently misreading a future layout as if it were this one.
   */
  function readIndexHeader() {
    if (!f.index || !existsSync(f.index)) return null
    try {
      const head = readFileSync(f.index, 'utf8').slice(0, 400)
      const fmt = head.match(/_format=([\w.-]+)/)
      if (fmt && fmt[1] !== INDEX_FORMAT) return null
      const off = head.match(/lastOffset=(\d+)/)
      const at = head.match(/syncedAt=(\d+)/)
      return {
        lastOffset: off ? Number(off[1]) : null,
        syncedAt: at ? BigInt(at[1]) : null,
      }
    } catch { return null }
  }

  /**
   * Load the bitmaps FROM the index instead of rebuilding them from the log.
   *
   * This is the line that ends the write-only index. Everything else in this
   * feature — the per-level bitmaps, the versioned header, the syncedAt — exists
   * so that this function can exist. Returns the offset the loaded state is good
   * up to, or null if the file is missing, stale-formatted or unparseable, in
   * which case the caller falls back to a full syncFrom(0).
   */
  function loadIndex() {
    const h = readIndexHeader()
    if (!h || h.lastOffset == null) return null
    try {
      const raw = readFileSync(f.index, 'utf8')
      const body = raw.slice(raw.indexOf('\n', raw.lastIndexOf('syncedAt=')) + 1)
      idx.bitmaps = deserialize(body)
      idx.syncedAt = h.syncedAt
      return h.lastOffset
    } catch { return null }
  }

  function saveIndex() {
    if (!f.index) return
    // ORDER ARBITER (feature 4.2, tightened by 1.5). Publication happens outside
    // the .dash lock, so two writers reach this point out of order and a slow one
    // can land after a fast one — an older index overwriting a newer.
    //
    // The offset comparison alone was not enough to stop that: read-compare-write
    // is not atomic, so both writers could read the same offset, both approve
    // themselves, and the older content could still win the rename by arriving
    // second. publishDerived() now takes the .index's OWN lock around the whole
    // sequence, which is a different lock from the .dash's — so this still does
    // not block a single append.
    //
    // The index is no longer merely a HINT (it is read at open() now), which is
    // exactly why the window had to close: a stale hint cost a rescan, but a
    // stale SOURCE costs a wrong allocation.

    // Header, then one line per level.
    //
    // `prefixes=` is gone. It listed every chosen prefix as text, grew linearly
    // with the record count, and — the actual defect — nobody ever read it back.
    // The per-level bitmaps carry the same fact in fixed size per level, and
    // loadIndex() above is what finally reads them.
    //
    // `syncedAt` is COPIED from the last record appended to the .dash, not
    // generated here. A derived file is valid AT the ts it carries: stale means
    // incomplete, not wrong. That is what lets open() align three files by
    // taking the lowest ts and syncing the delta.
    let out = `_v=${INDEX_V}\n_format=${INDEX_FORMAT}\n`
    out += `lastKey=${idx.lastKey || ''}\nlastOffset=${lastOffset}\n`
    out += `syncedAt=${idx.syncedAt ?? 0n}\n`
    out += serialize(idx.bitmaps)
    // The private temp + atomic rename that used to be written out here lives in
    // publishDerived() now, along with the arbiter and the lock — one place where
    // a derived file is put on disk, for both the .index and the .yaml.
    publishDerived({
      file: f.index,
      content: out,
      offset: lastOffset,
      readOffset: () => indexOffsetOnDisk(),
      lockBase: base, lockName: 'index',
    })
  }

  /**
   * Grava a projecao paginada E registra ate onde do log ela chegou.
   *
   * Existe porque o `logOffset` tem que andar junto com os bytes, sempre. Havia
   * quatro chamadas de `__flushPages()` espalhadas (genese, yield a cada 100,
   * close, e o replay do sync) e um offset atualizado em so algumas delas seria
   * pior que nenhum — na abertura seguinte ele afirmaria cobertura que o
   * arquivo nao tem, e o delta faltante sumiria em silencio.
   *
   * O offset e o TAMANHO DO `.dash` no instante da gravacao: tudo o que estava
   * no log ate aqui esta na projecao que acabou de ser escrita.
   */
  function flushProjection() {
    if (!paged) return
    const ate = existsSync(f.dash) ? statSync(f.dash).size : 0
    projection.__setLogOffset?.(ate)
    projection.__flushPages()
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
    // Cada linha carrega o offset ABSOLUTO em que comeca no `.dash`. E isso que
    // permite reaplicar so o delta: sem a posicao, "ja absorvido" nao e uma
    // pergunta respondivel sobre um registro individual.
    const texto = buf.toString('utf8')
    const recs = []
    let pos = offset
    for (const linha of texto.split('\n')) {
      const inicio = pos
      pos += Buffer.byteLength(linha) + 1
      if (!linha) continue
      const rec = parseLine(linha)
      if (rec) recs.push({ rec, at: inicio })
    }
    if (paged) {
      // The Proxy is the accumulator: _reduce mutates it in place, writes are
      // buffered, one flush covers the whole delta.
      //
      // O `.proj` e artefato DERIVADO: ele vale ate o ponto do log que ja
      // absorveu, e reaplicar o log inteiro por cima DUPLICA todo registro.
      // Entao a pergunta e "quanto deste log ja esta aqui dentro?".
      //
      // Ela agora e respondida por OFFSET, e nao por tamanho de arquivo. O
      // guarda anterior era `statSync(f.proj).size > 4096` — um literal, e nao
      // o `pageSize` do store. Com pagina menor que 4096 uma projecao de varias
      // paginas ainda mede menos que 4096 bytes, o guarda a lia como vazia, o
      // log inteiro era reaplicado e todo registro duplicava (medido: 40
      // escritas -> 80 registros em 2048/1024/512/256/128; so 4096 escapava,
      // porque ali tudo cabia numa pagina). Era o defeito registrado em
      // ISSUES/PROJ-REPLAY-ISSUE.md.
      //
      // O tamanho nunca foi a pergunta certa: ele e um proxy para "ja tem
      // conteudo", e o que importa nao e SE tem, e ATE ONDE. O `logOffset` no
      // rodape do pagedtext responde isso exatamente, sobrevive ao processo, e
      // fecha junto o gap que o codigo declarava em prosa aqui — um `.proj`
      // ATRASADO (menos registros que o log) antes era pulado por inteiro e
      // perdia o resto em silencio; agora o delta que falta e reaplicado.
      const projAt = existsSync(f.proj) ? (projection.__logOffset?.() ?? 0) : 0
      // Numa abertura do zero, o que ja esta na projecao e o que comeca ANTES
      // de `projAt`. Fora isso (sync incremental), tudo o que foi lido e novo
      // por construcao — `syncFrom` so leu a partir de `offset`.
      const novos = (offset === 0 && !_pagedSynced)
        ? recs.filter(r => r.at >= projAt)
        : recs
      for (const { rec } of novos) { try { _reduce(projection, rec) } catch { } }
      if (novos.length) flushProjection()
      _pagedSynced = true
    } else {
      projection = recs.reduce((acc, { rec }) => { try { return _reduce(acc, rec) } catch { return acc } }, projection)
    }
    if (offset === 0) {
      bmAdd(idx.bitmaps, toBits('0')); bmAdd(idx.bitmaps, toBits('1'))
      idx.records.add('0'); idx.records.add('1')
    }
    for (const { rec } of recs) {
      const key = Object.keys(rec)[0], payload = rec[key]
      if (key === '0') { idx.lastKey = '0'; continue }
      if (key === '1') { idx.lastKey = '1'; continue }
      const fullKey = makeFullKey(payload, idx.lastKey)
      const bits = toBits(key)
      idx.records.add(fullKey); bmAdd(idx.bitmaps, bits)
      idx.shortMap.set(key, fullKey); idx.shortMap.set(fullKey, fullKey)
      idx.hashMap.set(fullKey, payload)
      idx.lastKey = key
      idx.recordCount++
      // The ts a derived file will carry. Advanced here so it tracks what this
      // in-memory state has actually absorbed, whether the record came from our
      // own append or from another writer's delta.
      idx.syncedAt = nano()
      _sessionRecs.push(rec)  // accumulate so callers can skip disk re-reads
    }
    lastOffset = sz
    genesisWritten = true
  }

  /**
   * Provisional key computation — NO side-effects on the shared bitmaps.
   *
   * This runs outside the lock and may be thrown away and recomputed, so it must
   * not claim a name. It probes the real bitmaps for what is already taken and
   * keeps its own `pending` set for what THIS batch has provisionally taken, so
   * two records in one flush cannot pick the same prefix.
   *
   * The allocation is only made real inside the lock, where flush() calls
   * bmAdd() on the keys that actually landed.
   */
  function computeKeys(log, prevKey) {
    const pending = new Set()
    const taken = bits => pending.has(bits) || bmHas(idx.bitmaps, bits)
    // Start the walk at the level the collection's size implies; a stale or low
    // guess only costs extra probes, never a wrong name (feature 1.5).
    const startAt = positionToKeyLength(idx.recordCount)
    const pick = fullKey => {
      const bits = toBits(fullKey)
      for (let L = Math.max(1, startAt); L <= bits.length; L++) {
        const p = bits.slice(0, L)
        if (taken(p)) continue
        pending.add(p)
        const v = parseInt('1' + p, 2), key = toB64(v)
        return { p: key, key, n: L, bits: p }
      }
      pending.add(bits)
      return { p: fullKey, key: fullKey, n: bits.length, bits }
    }
    let prevK = prevKey
    return log.map(payload => {
      const pk = prevK
      const fullKey = makeFullKey(payload, prevK)
      const short = pick(fullKey)
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
    if (paged) {
      _reduce(projection, { '0': p0 })
      _reduce(projection, { '1': p1 })
      flushProjection()
    } else {
      projection = _reduce(_reduce(Array.isArray(_initial) ? [] : { ..._initial }, { '0': p0 }), { '1': p1 })
    }
    // PID-suffixed temp, for the same reason the index has one: a fixed `.tmp`
    // is shared by every process writing this base, and they clobber each other
    // mid write->rename. That was the bug 1.2 fixed for the index; it must not
    // come back through the projection's door.
    const tmp = `${f.yaml}.${process.pid}.tmp`
    writeFileSync(tmp, stringify(materialize(projection), { collectionStyle: 'block' })); renameSync(tmp, f.yaml)
    saveIndex()
    bmAdd(idx.bitmaps, toBits('0')); bmAdd(idx.bitmaps, toBits('1'))
    idx.records.add('0'); idx.records.add('1')
    idx.shortMap.set('0', '0'); idx.shortMap.set('1', '1')
    idx.lastKey = '1'
    lastOffset = statSync(f.dash).size
    genesisWritten = true
  }

  // Publish the YAML projection. No lock — this is feature 4.3's payoff.
  //
  // Under 4.2 this function had to REACQUIRE the lock just to do its final
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
    const yamlStr = stringify(materialize(projection), { collectionStyle: 'block' })   // O(n), .dash lock not held
    publishDerived({
      file: f.yaml,
      content: yamlStr,
      offset: lastOffset,
      readOffset: () => indexOffsetOnDisk(),
      // The .yaml's OWN lock — last in the fixed order .dash → .index → .yaml.
      // It does not block appends; it only serialises the read-compare-write
      // against another process publishing the same projection.
      lockBase: base, lockName: 'yaml',
    })
  }

  // Kept for close(), which publishes while already holding the lock. Releasing
  // is now a separate, explicit act: it used to be a side effect of renaming the
  // projection into place, because that rename WAS the release. With a dedicated
  // mutex the two are independent, and saying so costs one line.
  function flushYaml(projection, myLock) {
    const yamlStr = stringify(materialize(projection), { collectionStyle: 'block' })
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
    // The copy is a throwaway: it lets the pre-compute run (and fail) without
    // touching shared state. For the paged projection there is nothing to copy
    // cheaply — the store IS the state — so the pre-compute reduces over a plain
    // snapshot, and the real paged mutation happens inside the lock after the
    // append lands (see below).
    const _projCopy = () => paged
      ? materialize(projection)
      : (Array.isArray(projection) ? [...projection] : { ...projection })
    let newProjection = provisional.reduce(
      (acc, { short, payload }) => _reduce(acc, { [short.p]: payload }), _projCopy()
    )
    let allBytes = Buffer.from(provisional.map(p => p.line).join(''))
    if (t) t.precomputeEnd = Date.now()

    // ── Acquire lock (spin ≤ 1000ms) ─────────────────────────────────────────
    if (t) t.lockWaitStart = t.precomputeEnd
    // Nanosecond marks alongside the ms ones: the ms Date.now() marks feed
    // io-engine.bench.js unchanged, while _lockWaitNs / _criticalNs give
    // bench/compare-3.3.js the same resolution the nutshell gets from
    // appendGuarded's onPhase hook — the lock cost is sub-millisecond and
    // Date.now() cannot see it.
    const _wNs0 = t ? process.hrtime.bigint() : 0n
    const myLock = acquireLock(f.lock)
    if (t) { t.lockAcquired = Date.now(); t._lockWaitNs = Number(process.hrtime.bigint() - _wNs0) }   // seção crítica começa aqui
    const _cNs0 = t ? process.hrtime.bigint() : 0n

    try {
      // ── Re-sync from disk, then re-compute keys ───────────────────────────
      // Unconditional, not gated on a size check. The size check only tells us
      // whether the log GREW; it cannot tell us whether the prefixes we picked
      // outside the lock are still free. Under concurrency two writers can both
      // pass the size check, both syncFrom() to the same offset, and both pick
      // the SAME short prefix for DIFFERENT payloads — then append serially
      // under this lock, and the log has a duplicate key (feature 1.5). The
      // prefix allocation has to see what is actually on disk at the moment we
      // hold the lock, so syncFrom + computeKeys run every time. syncFrom() is
      // O(delta) and no-ops when nothing landed, so the cost is a statSync when
      // uncontended — the same as the old check.
      if (t) t.verifyStatStart = Date.now()
      syncFrom(lastOffset)
      if (t) t.verifyStatEnd = t.recomputeStart = Date.now()
      prevKey = idx.lastKey
      provisional = computeKeys(_log, prevKey)
      newProjection = provisional.reduce(
        (acc, { short, payload }) => _reduce(acc, { [short.p]: payload }),
        _projCopy()
      )
      allBytes = Buffer.from(provisional.map(p => p.line).join(''))
      if (t) t.recomputeEnd = Date.now()

      // ── Append log ────────────────────────────────────────────────────────
      // syncFrom() above just set lastOffset to the real file size, and the lock
      // is genuinely exclusive now (feature 1.5 fixed acquireLock), so no one
      // else appends between there and here: our bytes are the only delta.
      if (t) t.appendStart = Date.now()
      appendFileSync(f.dash, allBytes)
      lastOffset += allBytes.length
      if (t) t.appendEnd = Date.now()

      // ── Update in-memory state ────────────────────────────────────────────
      // Plain path: swap in the reduced copy. Paged path: replay the records
      // onto the real paged projection — the Proxy BUFFERS the writes in memory
      // and does NOT touch disk here. The .proj file is a derived artifact like
      // .yaml: it is written on the periodic yield and on close(), not on every
      // append. Flushing it per-append would put an O(store) rewrite back on the
      // hot path, which is exactly what feature 4.2 removed.
      if (paged) {
        for (const { short, payload } of provisional) _reduce(projection, { [short.p]: payload })
      } else {
        projection = newProjection
      }
      for (const { short, fullKey, payload } of provisional) {
        const bits = short.bits
        bmAdd(idx.bitmaps, bits); idx.records.add(fullKey)
        idx.shortMap.set(short.p, fullKey); idx.shortMap.set(fullKey, fullKey)
        idx.hashMap.set(fullKey, payload)
        idx.lastKey = short.p
        idx.recordCount++
        _sessionRecs.push({ [short.p]: payload })
      }
      // One ts for the batch, taken after the append landed. The derived files
      // published below both copy it, which is what makes "the triad is together
      // when the three ts agree" an O(1) check at open() instead of a scan.
      idx.syncedAt = nano()
      _log = []

      // ── Release the lock NOW (feature 4.2) ───────────────────────────────
      // The indivisible work is done: we checked the log had not grown, and we
      // appended. Everything below this line publishes DERIVED state — the
      // index and the YAML projection are both reconstructible from the .dash —
      // so holding the lock across it buys nothing and costs everything.
      //
      // That cost was measured (baseline 4.1): the critical section went from
      // p99=17ms at 1k records to 733ms at 100k, and in 100k×8 seven of eight
      // workers hit the lock timeout. `stringify` of a 100k projection alone is
      // ~790ms, and it ran with the lock held.
      // O `.yaml` NAO e mais reescrito a cada 100 flushes (feature 2.5). Ele e
      // derivado SOB DEMANDA: quem quer olhar, pede — `yaml()` na API publica —
      // e o `close()` grava a versao final. O contador segue existindo porque o
      // `.proj` continua sendo esvaziado periodicamente; o que saiu da carona
      // dele e so o YAML.
      //
      // A razao e medida, nao estetica: `stringify` do projection e O(n) e ele
      // rodava a cada 100 flushes sobre a projecao INTEIRA, enquanto o arquivo
      // que ele produz nunca e lido de volta por ninguem — nao ha um so
      // `readFileSync(f.yaml)` no `src/`. Era custo O(n) recorrente para
      // alimentar um artefato de leitura humana que talvez ninguem abra.
      const yieldFlush = ++flushCount % 100 === 0
      releaseLock(myLock, f.lock)       // release: rename the mutex back, nothing else
      if (t) { t.lockReleased = Date.now(); t._criticalNs = Number(process.hrtime.bigint() - _cNs0) }   // seção crítica termina aqui

      // ── Publish derived state, lock released ─────────────────────────────
      if (t) t.publishStart = t.lockReleased
      saveIndex()                       // arbitrated by lastOffset (see saveIndex)
      if (yieldFlush) flushProjection()

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
        // FAST OPEN (feature 1.5). The index is finally read, not just written.
        //
        // The old comment here explained why a full rebuild was unavoidable: the
        // index's offset tracked the raw append position while `projection` had
        // to come from the yaml snapshot, and the two were not in step, so a
        // fresh process could not safely delta-sync from the index's offset.
        //
        // What changed is that the index now carries its own bitmaps. The two
        // halves of open() have different sources and can be satisfied
        // separately: the ALLOCATOR loads from the .index in O(size of index),
        // and only the PROJECTION still needs the log. So we load the bitmaps
        // first and let syncFrom() rebuild the projection over them — the
        // records it re-reads simply re-assert bits that are already set, which
        // is idempotent (bmAdd returns false and changes nothing).
        //
        // A missing, older-format or corrupt index costs exactly what the old
        // path always paid, a rebuild from the .dash, and never a wrong answer:
        // loadIndex() returns null and the bitmaps stay empty for syncFrom(0) to
        // fill. That is the property the "corrupt the index" test asserts.
        const at = loadIndex()
        if (at == null) idx.bitmaps = makeBitmaps()
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
      // Persist the paged projection's buffered writes. Like the .yaml below it
      // is a derived artifact, written once at close rather than per append.
      // O `catch {}` mudo SAIU (requisito da 4.5): falha ao gravar a projecao
      // canonica no fechamento e perda de dado derivado, e engoli-la em
      // silencio deixava o processo sair como se tivesse gravado.
      if (paged && existsSync(f.dash)) flushProjection()
      // O YAML final. Agora que ele nao e mais escrito a cada 100 flushes, o
      // `close()` e o unico ponto automatico — e por isso a condicao deixou de
      // olhar o contador: ele nao diz mais nada sobre o YAML estar em dia.
      if (existsSync(f.dash)) {
        const myLock = acquireLock(f.lock)
        try { flushYaml(projection, myLock) } catch { try { releaseLock(myLock, f.lock) } catch { } }
      }
    },
    in: write,
    flush,
    get,
    // O `.yaml` sob demanda. Ele deixou de ser reescrito periodicamente na 2.5;
    // esta e a porta de quem quer olhar o estado em YAML sem esperar o
    // `close()`. Devolve o caminho do arquivo que acabou de publicar.
    yaml() { publishYaml(); return f.yaml },
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
