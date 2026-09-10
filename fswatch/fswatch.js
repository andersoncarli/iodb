import { readFile, stat, lstat, readdir, mkdir } from 'node:fs/promises'
import { watch as nodeWatch } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Database } from 'bun:sqlite'
import IO, { merge } from '../src/io-engine.js'

const HOME = os.homedir()
const SEP = path.sep
const slash = p => p.split(SEP).join('/')
const expand = p => path.resolve(String(p).replace(/^~(?=$|\/)/, HOME))
const key = (dev, ino) => `${Number(dev)}:${Number(ino)}`

const glob = source => {
  let r = '^'
  const s = String(source)
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '*') {
      if (s[i + 1] === '*') {
        i++
        if (s[i + 1] === '/') { i++; r += '(?:.*/)?' }
        else r += '.*'
      } else r += '[^/]*'
    } else if (c === '?') r += '[^/]'
    else r += /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c
  }
  return new RegExp(`${r}$`)
}

const compile = patterns => (patterns || []).map(p => p instanceof RegExp ? p : glob(p))

const Filter = ({ include = ['**/*'], exclude = [] }) => {
  const inc = compile(include)
  const exc = compile(exclude)
  const test = value => {
    const p = slash(value)
    return !exc.some(r => r.test(p)) && inc.some(r => r.test(p))
  }
  const excludedDir = value => exc.some(r => r.test(`${slash(value).replace(/\/$/, '')}/x`))
  return { test, excludedDir }
}

const loadYaml = async filename => parseYaml(await readFile(expand(filename), 'utf8'))

// Small YAML subset intentionally supported by core: mappings, arrays, quoted/unquoted scalars.
// The configuration format needs no YAML features beyond these.
const parseYaml = text => {
  const lines = text.split(/\r?\n/).map(raw => {
    const clean = raw.replace(/\s+#.*$/, '').trimEnd()
    return clean
  }).filter(x => x.trim())

  const scalar = s => {
    s = s.trim()
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1)
    if (s === '[]') return []
    if (s === '{}') return {}
    if (s === 'true') return true
    if (s === 'false') return false
    if (s === 'null') return null
    return s
  }

  const block = (index, indent) => {
    const first = lines[index]
    if (!first || first.match(/^ */)[0].length < indent) return [{}, index]
    const array = first.trim().startsWith('- ')
    const out = array ? [] : {}
    let i = index
    while (i < lines.length) {
      const raw = lines[i]
      const n = raw.match(/^ */)[0].length
      if (n < indent) break
      if (n > indent) throw Error(`Invalid YAML indentation: ${raw}`)
      const s = raw.trim()
      if (array) {
        if (!s.startsWith('- ')) throw Error(`Mixed YAML sequence/mapping: ${raw}`)
        out.push(scalar(s.slice(2)))
        i++
        continue
      }
      const colon = s.indexOf(':')
      if (colon < 1) throw Error(`Invalid YAML mapping: ${raw}`)
      const k = s.slice(0, colon).trim()
      const v = s.slice(colon + 1).trim()
      if (v) { out[k] = scalar(v); i++; continue }
      const next = i + 1
      if (next >= lines.length) { out[k] = {}; i++; continue }
      const ni = lines[next].match(/^ */)[0].length
      const [child, end] = block(next, ni)
      out[k] = child
      i = end
    }
    return [out, i]
  }
  return lines.length ? block(0, lines[0].match(/^ */)[0].length)[0] : {}
}

const normalizeConfig = raw => {
  const clusters = {}
  if (raw.include || raw.exclude) {
    clusters.DEFAULT = {
      targets: raw.targets || [], include: raw.include || ['**/*'], exclude: raw.exclude || []
    }
  }
  for (const [name, cfg] of Object.entries(raw)) {
    if (name === 'include' || name === 'exclude' || name === 'targets') continue
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue
    clusters[name] = {
      targets: cfg.targets || [],
      include: cfg.include || ['**/*'],
      exclude: cfg.exclude || []
    }
  }
  if (!Object.keys(clusters).length) throw Error('FSWatch requires at least one cluster')
  return { clusters }
}

// The metadata baseline is an iodb store keyed by `dev:ino`. The engine's `merge`
// reducer gives upsert and, through a null value, the tombstone that stands in for
// DELETE. There is no nodes/leaves split: that separation existed for SQL typing and
// per-table indexes, and `kind` is already a field on every entry (see feature 6.4).
const MetadataStore = base => {
  const io = IO(base, { reduce: merge, initial: {}, pageSize: 4096 })
  io.open()

  // `merge` is SHALLOW: for an object value it spreads over what is already there
  // rather than replacing it. SQLite deleted the row from the other table before
  // upserting, so a dir landing on a file of the same (dev,ino) started clean. Here
  // nothing is deleted, so every field must be written explicitly on every put —
  // otherwise `size` and `hash` survive a file->dir flip. `null` in `merge` removes
  // the field, which is what the SQL `all()` already synthesised for dirs.
  const normalize = e => ({
    id: e.id, parent: e.parent ?? null, name: e.name, kind: e.kind,
    dev: e.dev, ino: e.ino, mode: e.mode, mtime: e.mtime, ctime: e.ctime,
    size: e.kind === 'dir' ? null : (e.size ?? null),
    hash: e.hash ?? null,
    ...(e.path ? { path: e.path } : {})
  })

  const put = (e, { flush = true } = {}) => {
    const row = normalize(e)
    mirror.set(e.id, row)
    return io.in({ [e.id]: row }, { flush })
  }
  const remove = (id, { flush = true } = {}) => {
    mirror.delete(id)
    return io.in({ [id]: null }, { flush })
  }
  const flush = () => io.flush()
  // Reading the live paged projection by key returns undefined for every key, even
  // though Object.keys lists it (iodb defect, see sprint 017 report). Values are
  // durable and a reopened store reads them back fine, so the baseline is kept in a
  // process-local mirror and the store stays the durable copy. Drop the mirror once
  // the engine serves live reads.
  const mirror = new Map()
  // open() replays the log, so what it produced is readable HERE, at construction,
  // before the live-read defect applies to subsequent writes.
  for (const [k, v] of Object.entries(io.get('#1') ?? {}))
    if (/^\d+:\d+$/.test(k) && v && typeof v === 'object') mirror.set(k, v)
  const all = () => [...mirror.values()]

  const close = () => io.close()
  return { io, put, remove, flush, all, close, path: () => io.path() }
}

// The SQLite backend, kept as a peer of the iodb one and shaped to the SAME
// interface: put/remove/flush/all/close. It is one table, not the old nodes/leaves
// split — that separation was SQL bookkeeping and `kind` already carries the
// distinction (feature 6.4). `flush` is a no-op here because every write is already
// durable; the method exists so callers never branch on the backend.
const SqliteStore = base => {
  const file = base.endsWith('.sqlite') ? base : `${base}.sqlite`
  const db = new Database(file)
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS entries(
      id TEXT PRIMARY KEY, parent TEXT, name TEXT NOT NULL, kind TEXT NOT NULL,
      dev INTEGER NOT NULL, ino INTEGER NOT NULL, size INTEGER, mode INTEGER,
      mtime INTEGER, ctime INTEGER, hash TEXT, path TEXT
    );
    CREATE INDEX IF NOT EXISTS entries_parent ON entries(parent);
    CREATE INDEX IF NOT EXISTS entries_kind ON entries(kind);
  `)
  const upsert = db.query(`
    INSERT INTO entries(id,parent,name,kind,dev,ino,size,mode,mtime,ctime,hash,path)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET parent=excluded.parent,name=excluded.name,
    kind=excluded.kind,dev=excluded.dev,ino=excluded.ino,size=excluded.size,
    mode=excluded.mode,mtime=excluded.mtime,ctime=excluded.ctime,hash=excluded.hash,
    path=excluded.path
  `)
  const put = e => upsert.run(e.id, e.parent ?? null, e.name, e.kind, e.dev, e.ino,
    e.kind === 'dir' ? null : (e.size ?? null), e.mode, e.mtime, e.ctime,
    e.hash ?? null, e.path ?? null)
  const remove = id => db.query('DELETE FROM entries WHERE id=?').run(id)
  const all = () => db.query('SELECT * FROM entries').all()
  return { db, put, remove, flush: () => {}, all, close: () => db.close(), path: () => file }
}

const BACKENDS = { iodb: MetadataStore, sqlite: SqliteStore }

const describe = async (filename, parent = null) => {
  const s = await lstat(filename)
  const dir = s.isDirectory()
  return {
    id: key(s.dev, s.ino), parent, name: path.basename(filename) || filename,
    kind: dir ? 'dir' : 'file', dev: Number(s.dev), ino: Number(s.ino),
    size: dir ? undefined : Number(s.size), mode: s.mode,
    mtime: Number(s.mtimeMs), ctime: Number(s.ctimeMs), hash: null
  }
}

// The scan buffers. Each io.in() is a real fsync (~1ms), and one put per file makes a
// full sweep of a large tree cost tens of seconds. Buffering trades per-record
// durability for viability, and the trade is safe HERE specifically: a scan is a read
// of the filesystem, which is the source of truth, so a partial baseline lost to a
// crash is rebuilt by the next scan. The live watcher does NOT buffer — there each
// event is a unique observation that no rescan can recover.
const Scanner = (store, pruned = () => false) => {
  const scan = async targets => {
    const found = new Map()
    const walk = async (dir, parent) => {
      let entries
      try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
      for (const d of entries) {
        const full = path.join(dir, d.name)
        let e
        try { e = await describe(full, parent) } catch { continue }
        found.set(e.id, e); store.put(e, { flush: false })
        // A pruned directory is COUNTED AND KNOWN, not skipped: its own entry is
        // stored, so its existence and mtime are tracked, but we do not descend.
        if (e.kind === 'dir' && !pruned(full)) await walk(full, e.id)
      }
    }
    for (const target of targets) {
      let e
      try { e = await describe(expand(target)) } catch { continue }
      found.set(e.id, e); store.put(e, { flush: false })
      if (e.kind === 'dir' && !pruned(expand(target))) await walk(expand(target), e.id)
    }
    store.flush()
    return found
  }
  return { scan }
}

const diff = (before, after) => {
  const events = []
  for (const [id, old] of before) {
    const now = after.get(id)
    if (!now) events.push({ type: 'delete', id, path: old.path, kind: old.kind })
    else if (old.path !== now.path) events.push({ type: 'move', id, from: old.path, path: now.path, kind: now.kind })
    else if (old.mtime !== now.mtime || old.ctime !== now.ctime || old.mode !== now.mode || old.size !== now.size)
      events.push({ type: 'metadata_changed', id, path: now.path, metadata: now })
  }
  for (const [id, now] of after)
    if (!before.has(id)) events.push({ type: 'create', id, path: now.path, kind: now.kind })
  return events
}

const Cluster = (name, cfg) => {
  const filter = Filter(cfg)
  const listeners = new Set()
  const on = fn => { listeners.add(fn); return () => listeners.delete(fn) }
  const emit = event => {
    const p = event.path || event.from || ''
    if (filter.test(p)) for (const fn of listeners) fn(event)
  }
  return { name, targets: cfg.targets.map(expand), on, off: fn => listeners.delete(fn), _emit: emit }
}

const FSWatch = async input => {
  const yaml = typeof input === 'string'
  const raw = yaml ? await loadYaml(input) : structuredClone(input || {})
  const config = normalizeConfig(raw)
  // One domain per project: <root>/.fswatch/<name> is a BASE, not a file — the engine
  // derives .dash/.yaml/.index/.lock/.proj from it.
  // For a YAML config the domain is the config file: <its dir>/.fswatch/<its name>.
  // For a POJO there is no config file to anchor to, so the domain is the first target
  // — each watched tree owns its own baseline. Anchoring a POJO to the cwd instead
  // would make every FSWatch in a process share one store, which is how state leaked
  // between tests before this feature.
  const firstTarget = Object.values(config.clusters).flatMap(c => c.targets)[0]
  const root = yaml ? path.dirname(expand(input)) : expand(firstTarget || '.')
  const dbDir = path.join(root, '.fswatch')
  await mkdir(dbDir, { recursive: true })
  const domain = yaml ? path.basename(expand(input)).replace(/\.[^.]+$/, '') : 'metadata'
  const dbBase = path.join(dbDir, domain)
  const backend = raw.backend || 'iodb'
  if (!BACKENDS[backend]) throw Error(`Unknown backend: ${backend} (have: ${Object.keys(BACKENDS).join(', ')})`)
  const store = BACKENDS[backend](dbBase)

  // Directories every cluster excludes are counted but not descended into. This is
  // narrower than making `exclude` prune in general (a gap the front leaves open): it
  // is the minimum that makes real trees affordable, and the directory entry itself
  // is still stored, so its existence and mtime remain observable.
  const clusterFilters = Object.values(config.clusters).map(c => Filter(c))
  // The store lives inside the tree it observes, so the watcher would see the engine's
  // own writes, store them, and write again — an unbounded feedback loop. `.fswatch/`
  // is never observed, and that is structural, not a user-configurable exclude.
  const isStore = p => slash(expand(p)).startsWith(slash(dbDir))
  const pruned = dir => isStore(dir) ||
    (clusterFilters.length > 0 && clusterFilters.every(f => f.excludedDir(dir)))
  const scanner = Scanner(store, pruned)
  const clusters = Object.fromEntries(Object.entries(config.clusters).map(([n,c]) => [n,Cluster(n,c)]))
  const watchers = new Map()
  const listeners = new Set()
  let closed = false
  let baseline = new Map()
  const emit = event => {
    if (closed) return
    if (isStore(event.path || event.from || '')) return
    for (const fn of listeners) fn(event)
    for (const cluster of Object.values(clusters)) cluster._emit(event)
  }

  const snapshot = async targets => {
    const current = new Map()
    const roots = targets.map(expand)
    const walk = async (full, parentPath = null) => {
      let e
      try { e = await describe(full, parentPath ? parentPath.id : null) } catch { return }
      e.path = full
      current.set(e.id, e)
      if (e.kind !== 'dir' || pruned(full)) return
      let list
      try { list = await readdir(full, { withFileTypes:true }) } catch { return }
      for (const d of list) await walk(path.join(full,d.name), e)
    }
    for (const root of roots) await walk(root)
    return current
  }

  const reconcile = async (targets = Object.values(clusters).flatMap(c => c.targets), reason = 'manual') => {
    const next = await snapshot([...new Set(targets)])
    for (const e of next.values()) store.put(e)
    for (const e of baseline.values()) if (!next.has(e.id)) store.remove(e.id)
    for (const event of diff(baseline, next)) emit(event)
    baseline = next
    if (reason !== 'manual') emit({ type:'reconcile', path: targets[0] || '.', reason })
    return next
  }

  const watchTree = async dir => {
    dir = expand(dir)
    if (watchers.has(dir)) return
    let watcher
    try {
      watcher = nodeWatch(dir, { persistent:true }, async (type, filename) => {
        if (closed || !filename) return
        const full = path.join(dir, String(filename))
        // Drop the store's own writes BEFORE they are persisted. Filtering only at
        // emit() is too late: the callback calls store.put first, and that write
        // retriggers this watcher — an unbounded loop that hangs the process.
        if (isStore(full)) return
        if (type === 'rename') {
          try {
            const e = await describe(full)
            if (e.kind === 'dir') await watchTree(full)
            emit({ type:'create', id:e.id, path:full, kind:e.kind })
            store.put(e)
            baseline.set(e.id, {...e,path:full})
          } catch {
            const old = [...baseline.values()].find(e => e.path === full)
            if (old) { store.remove(old.id); baseline.delete(old.id); emit({ type:'delete',id:old.id,path:full,kind:old.kind }) }
          }
        } else {
          try {
            const e = await describe(full)
            e.path = full
            store.put(e); baseline.set(e.id,e)
            emit({ type:'metadata_changed', id:e.id, path:full, metadata:e })
          } catch {}
        }
      })
    } catch { return }
    watchers.set(dir, watcher)
    if (pruned(dir)) return
    let list
    try { list = await readdir(dir,{withFileTypes:true}) } catch { return }
    for (const d of list) if (d.isDirectory()) await watchTree(path.join(dir,d.name))
  }

  const scan = async () => {
    const targets = [...new Set(Object.values(clusters).flatMap(c => c.targets))]
    await scanner.scan(targets)
    baseline = await snapshot(targets)
    return baseline
  }
  const watch = async ({ baselineFirst = true } = {}) => {
    if (baselineFirst) await scan()
    for (const target of [...new Set(Object.values(clusters).flatMap(c => c.targets))]) await watchTree(target)
    return api
  }
  const on = fn => { listeners.add(fn); return () => listeners.delete(fn) }
  const io_path = () => store.path()
  const stats = () => ({ entries: store.all().length, watchers: watchers.size, clusters: Object.keys(clusters).length, database: io_path() })
  const close = () => { if (closed) return; closed = true; for (const w of watchers.values()) w.close(); watchers.clear(); store.close() }
  const api = { ...clusters, scan, watch, reconcile, on, off:fn=>listeners.delete(fn), stats, close, entries: () => store.all() }
  return api
}

export { FSWatch, parseYaml, normalizeConfig, glob, Filter, MetadataStore, SqliteStore, BACKENDS }
