import { Database } from 'bun:sqlite'
import { readFile, stat, lstat, readdir } from 'node:fs/promises'
import { watch as nodeWatch } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

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

const MetadataStore = filename => {
  const db = new Database(filename)
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS nodes(
      id TEXT PRIMARY KEY, parent TEXT, name TEXT NOT NULL, kind TEXT NOT NULL,
      dev INTEGER NOT NULL, ino INTEGER NOT NULL, mode INTEGER, mtime INTEGER, ctime INTEGER
    );
    CREATE TABLE IF NOT EXISTS leaves(
      id TEXT PRIMARY KEY, parent TEXT, name TEXT NOT NULL, kind TEXT NOT NULL,
      dev INTEGER NOT NULL, ino INTEGER NOT NULL, size INTEGER, mode INTEGER,
      mtime INTEGER, ctime INTEGER, hash TEXT
    );
    CREATE INDEX IF NOT EXISTS nodes_parent ON nodes(parent);
    CREATE INDEX IF NOT EXISTS leaves_parent ON leaves(parent);
    CREATE INDEX IF NOT EXISTS leaves_inode ON leaves(dev,ino);
  `)

  const put = e => {
    const table = e.kind === 'dir' ? 'nodes' : 'leaves'
    const other = table === 'nodes' ? 'leaves' : 'nodes'
    db.query(`DELETE FROM ${other} WHERE id=?`).run(e.id)
    if (table === 'nodes') db.query(`
      INSERT INTO nodes(id,parent,name,kind,dev,ino,mode,mtime,ctime)
      VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET parent=excluded.parent,name=excluded.name,
      kind=excluded.kind,dev=excluded.dev,ino=excluded.ino,mode=excluded.mode,
      mtime=excluded.mtime,ctime=excluded.ctime
    `).run(e.id,e.parent,e.name,e.kind,e.dev,e.ino,e.mode,e.mtime,e.ctime)
    else db.query(`
      INSERT INTO leaves(id,parent,name,kind,dev,ino,size,mode,mtime,ctime,hash)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET parent=excluded.parent,name=excluded.name,
      kind=excluded.kind,dev=excluded.dev,ino=excluded.ino,size=excluded.size,
      mode=excluded.mode,mtime=excluded.mtime,ctime=excluded.ctime,hash=excluded.hash
    `).run(e.id,e.parent,e.name,e.kind,e.dev,e.ino,e.size,e.mode,e.mtime,e.ctime,e.hash ?? null)
  }

  const remove = id => {
    db.query('DELETE FROM nodes WHERE id=?').run(id)
    db.query('DELETE FROM leaves WHERE id=?').run(id)
  }
  const all = () => [
    ...db.query('SELECT id,parent,name,kind,dev,ino,mode,mtime,ctime,NULL size,NULL hash FROM nodes').all(),
    ...db.query('SELECT id,parent,name,kind,dev,ino,size,mode,mtime,ctime,hash FROM leaves').all()
  ]
  const close = () => db.close()
  return { db, put, remove, all, close }
}

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

const Scanner = store => {
  const scan = async targets => {
    const found = new Map()
    const walk = async (dir, parent) => {
      let entries
      try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
      for (const d of entries) {
        const full = path.join(dir, d.name)
        let e
        try { e = await describe(full, parent) } catch { continue }
        found.set(e.id, e); store.put(e)
        if (e.kind === 'dir') await walk(full, e.id)
      }
    }
    for (const target of targets) {
      let e
      try { e = await describe(expand(target)) } catch { continue }
      found.set(e.id, e); store.put(e)
      if (e.kind === 'dir') await walk(expand(target), e.id)
    }
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
  const dbFile = yaml ? path.join(path.dirname(expand(input)), 'bun.sqlite') : path.resolve('bun.sqlite')
  const store = MetadataStore(dbFile)
  const scanner = Scanner(store)
  const clusters = Object.fromEntries(Object.entries(config.clusters).map(([n,c]) => [n,Cluster(n,c)]))
  const watchers = new Map()
  const listeners = new Set()
  let closed = false
  let baseline = new Map()
  const emit = event => {
    if (closed) return
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
      if (e.kind !== 'dir') return
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
  const stats = () => ({ entries: store.all().length, watchers: watchers.size, clusters: Object.keys(clusters).length, database: dbFile })
  const close = () => { if (closed) return; closed = true; for (const w of watchers.values()) w.close(); watchers.clear(); store.close() }
  const api = { ...clusters, scan, watch, reconcile, on, off:fn=>listeners.delete(fn), stats, close, db:store.db }
  return api
}

export { FSWatch, parseYaml, normalizeConfig, glob, Filter }
