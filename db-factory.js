/**
 * io/db.js — Polymorphic Helix Factory (11.36 DX)
 *
 * Dispatch rules:
 *   DB('.env.yaml')   → file-direct → collection proxy  (Scenario A)
 *   DB('MODELS')      → named → resolves file → proxy   (Scenario A via name)
 *   DB('io')          → namespace → factory instance    (Scenario B)
 *   DB('path/')      → same as DB('io', { path })
 */

import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import IO, { merge, append, assign } from './io-engine.js'
import { TRANSITION, ON } from '../bus.js'
import { findProjectRoot } from '../config.js'
import { NodeAdapter } from './60-node.js'

 let _globalDB = null
 export function getGlobalDB() { return _globalDB }

 const __dirname = dirname(fileURLToPath(import.meta.url))
 const ADAPTERS_PATH = __dirname

 const BACKENDS = {}
 const EXT_MAP = {}

 const entries = readdirSync(ADAPTERS_PATH)
   .filter(f => f.endsWith('.js') && !f.endsWith('.t.js') && f.match(/^\d+-/))
   .sort((a, b) => parseInt(a) - parseInt(b))

 for (const entry of entries) {
   const handle = entry.match(/^\d+-(.+)\.js$/)[1]
   const module = await import(`./${entry}`)
   const capitalized = handle[0].toUpperCase() + handle.slice(1)
   const factory = module[`${capitalized}Collection`]
     ?? module[`${capitalized}Factory`]
     ?? module[handle]
     ?? module.default
   if (factory) {
     BACKENDS[handle] = factory
     EXT_MAP[handle] = handle // Each adapter handles its own name as extension
     if (module.extensions) {
       for (const ext of module.extensions) EXT_MAP[ext] = handle
     }
   }
 }
BACKENDS['sqlite'] = (await import('./50-sqlite.js')).default
BACKENDS['stream'] = (filePath, opts) => IO(filePath, { reduce: append, initial: [] })

// ── IO Type Reducers ──────────────────────────────────────────────────────────

const TYPES = {
  stream: { reduce: append,     initial: [] },
  store:  { reduce: merge,      initial: {} },
  kv:     { reduce: assign,     initial: {} },
  table:  { reduce: upsertById, initial: {} },
  map:    { reduce: assign,     initial: {} },
  bloom:  { reduce: (acc, rec) => ({ ...acc, ...rec }), initial: {} },
}

function upsertById(acc, rec) {
  const v = Object.values(rec)[0]
  if (!v || !v.id) return acc
  return { ...acc, [v.id]: v }
}


// ── Null collection sentinel ──────────────────────────────────────────────────
// Returned when a named collection has no backing file yet
const NULL_COLLECTION = Object.freeze({
  get: () => undefined,
  in: () => undefined,
  put: () => undefined,
  out: () => {},
  open: () => NULL_COLLECTION,
  size: 0,
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureDir(filePath) {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }) } catch (e) {}
  }
}

// Parse signature: "name Backend Class1 Class2" → { name, backend, classes }
function parseSignature(sig) {
  if (typeof sig !== 'string') return { name: sig, backend: null, classes: [] }
  const parts = sig.trim().split(/\s+/)
  const name = parts.shift()
  const backend = parts.find(p => BACKENDS[p]) || null
  const classes = parts.filter(p => !BACKENDS[p] && (TYPES[p] || ['sql', 'blob', 'map', 'bloom', 'index'].includes(p)))
  return { name, backend, classes }
}

// Add .count on nested object values for convenience (DB('MODELS').ROLES.count)
function wrapWithCount(col) {
  return new Proxy(col, {
    get(t, k) {
      const base = typeof k === 'symbol' || k in t ? t[k] : t.get(String(k))
      if (base && typeof base === 'object' && !Array.isArray(base) && typeof k !== 'symbol') {
        if (!Object.prototype.hasOwnProperty.call(base, 'count')) {
          Object.defineProperty(base, 'count', {
            get() { return Object.keys(this).filter(k => k !== 'count').length },
            configurable: true
          })
        }
      }
      if (k === 'branch') return (_branch) => {
        // Flatten collection state into an array of entry-like objects
        const state = typeof t.get === 'function' ? t.get() : null
        if (!state || typeof state !== 'object') return []
        // If already an array (stream), return as-is
        if (Array.isArray(state)) return state
        // Single merged state object: return as one entry
        return [state]
      }
      if (k === 'rm') return () => {
         const p = (typeof t.path === 'function' ? t.path() : t.path) || t.id
         if (p && existsSync(p)) rmSync(p, { recursive: true, force: true })
      }
      if (k === 'stat') return () => {
         const p = (typeof t.path === 'function' ? t.path() : t.path) || t.id
         return existsSync(p) ? statSync(p) : null
      }
      if (k === 'exists') return existsSync((typeof t.path === 'function' ? t.path() : t.path) || t.id)
      if (k === 'count') return t.size ?? 0
      if (k === 'type') return t.type

      const res = base
      if (typeof res === 'function') return res.bind(t)
      return res
    }
  })
}

// Open a physical file as a collection proxy (Scenario A)
function openCollection(filePath, opts = {}) {
  if (!filePath.includes('.') && (!existsSync(filePath) || !statSync(filePath).isDirectory())) {
    const candidates = (DB.extensions ? DB.extensions() : []).map(ext => filePath + '.' + ext)
    const found = candidates.find(p => existsSync(p))
    if (found) filePath = found
  }
  const ext = filePath.split('.').pop().toLowerCase()
  let backendName = opts.type || EXT_MAP[ext]

  if (!backendName) {
    // Unknown extension: test for text or binary
    if (existsSync(filePath)) {
      const stat = statSync(filePath)
      if (stat.isFile()) {
        try {
          const buf = readFileSync(filePath)
          const isBinary = buf.some(b => b === 0)
          backendName = isBinary ? 'blob' : 'file'
        } catch (e) { backendName = 'file' }
      } else if (stat.isDirectory()) {
        backendName = 'folder'
      } else {
        backendName = 'file'
      }
    } else {
      backendName = 'file'
    }
  }

  const factory = BACKENDS[backendName]

  if (!factory) throw new Error(`[db] No backend for extension: .${ext} (${filePath}). Backends: ${Object.keys(BACKENDS)}`)

  // Return cached collection without re-opening (prevents yaml reconstruction on .exists check)
  const registry = globalThis.__COLLECTION_REGISTRY__
  const absFilePath = resolve(filePath)
  const registryKey = `${backendName}:${absFilePath}`
  if (registry && registry.has(registryKey)) return wrapWithCount(registry.get(registryKey))

  ensureDir(filePath)
  const col = factory(filePath, opts)
  col.open()
  if (registry) registry.set(registryKey, col)
  return wrapWithCount(col)
}

// Find a named collection's file in the DB/ hierarchy.
// Named collections always use DashCollection regardless of extension.
function findNamedFile(name, root) {
  const base = join(root, 'DB')
  const candidates = [
    join(base, name, name + '.yaml'),  // DB/MODELS/MODELS.yaml  ← preferred
    join(base, name + '.yaml'),        // DB/MODELS.yaml
    join(base, name + '.dash'),        // DB/MODELS.dash
    join(base, name, name + '.dash'),  // DB/MODELS/MODELS.dash
  ]
  const found = candidates.find(p => existsSync(p))
  if (found) return found

  // Seed target: .dash or -INIT.yaml exists → return target .yaml path (will be seeded on open)
  const initPath = join(base, name, name + '-INIT.yaml')
  const dashPath = join(base, name, name + '.dash')
  if (existsSync(dashPath) || existsSync(initPath)) {
    return join(base, name, name + '.yaml')
  }
  return null
}

// Open a named collection — uses YAML adapter for .yaml/.yml, Dash for everything else
function openNamedCollection(filePath, opts = {}) {
  const ext = (filePath.split('.').pop() || '').toLowerCase()
  const backendName = (ext === 'yaml' || ext === 'yml') ? 'yaml' : 'dash'
  const factory = BACKENDS[backendName] || BACKENDS['dash']
  if (!factory) throw new Error(`[db] No adapter for: ${backendName}`)
  ensureDir(filePath)
  const col = factory(filePath, opts)
  col.open()
  return wrapWithCount(col)
}

// ── Stream proxy: wraps IO with put/settle/two-arg-in for Avalanche Protocol ─
function _streamProxy(io) {
  const _origIn = io.in.bind(io)   // capture before proxy overwrites it
  const _write = (typeOrPatch, payload) => {
    if (typeof typeOrPatch === 'string' && payload !== undefined)
      return _origIn({ ...payload, type: typeOrPatch })
    return _origIn(typeOrPatch)
  }
  const settle = (token, timeout = 30000) => {
    const ref = String(token ?? '').replace(/^#/, '')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`[IO] settle timeout (${timeout}ms)`)), timeout)
      const matchRecord = (payload) => payload?.type === 'result' && (payload?._prev === ref || payload?._ref === ref)
      // Check only in-session records: results are always written after tokens are created,
      // so historical records from prior sessions can never match our fresh token.
      const fastRecs = io.sessionRecords ? io.sessionRecords() : []
      const existing = fastRecs
        .map(r => ({ key: Object.keys(r)[0], payload: Object.values(r)[0] }))
        .find(({ payload }) => matchRecord(payload))
      if (existing) { clearTimeout(timer); return resolve(existing.payload) }
      const off = io.out(({ key, fullKey, payload }) => {
        if (matchRecord(payload)) { clearTimeout(timer); off(); clearInterval(poll); resolve(payload) }
      })
      // Fallback poll: check session records only (no disk read), in case bus was cleared.
      const poll = setInterval(() => {
        const recs = io.sessionRecords ? io.sessionRecords() : []
        const found = recs
          .map(r => ({ key: Object.keys(r)[0], payload: Object.values(r)[0] }))
          .find(({ payload }) => matchRecord(payload))
        if (found) { clearTimeout(timer); off(); clearInterval(poll); resolve(found.payload) }
      }, 100)
    })
  }
  const proxy = wrapWithCount(io)
  proxy.in  = _write
  proxy.put = _write
  proxy.settle = settle
  proxy.load = () => io.records().map(r => ({ key: Object.keys(r)[0], payload: Object.values(r)[0] }))
  return proxy
}

// ── DB — Polymorphic Factory Entry Point (11.36 §2) ──────────────────────────

globalThis.__DB_FACTORY__ = DB; export function DB(target = 'io', opts = {}) {
  // Polymorphic: DB({ path }) == DB('io', { path })
  if (typeof target === 'object' && target !== null && !Array.isArray(target)) {
    opts = target; target = 'io'
  }
  if (typeof opts === 'string') opts = { type: opts }

  const cachedRoot = _globalDB ? (typeof _globalDB.path === 'function' ? _globalDB.path() : _globalDB.path) : null
  const root = opts.path
    || (cachedRoot && existsSync(cachedRoot) ? cachedRoot : null)
    || findProjectRoot()

  // Resolve // prefix → project-root relative
  if (typeof target === 'string' && target.startsWith('//')) {
    const factoryRoot = target === '//' ? '/' : join(root, target.slice(2))
    return createFactory(factoryRoot, { ...opts, _direct: true })
  }

  if (target === 'DB') return openCollection(join(root, 'DB'), { type: 'folder' })
  if (target === 'STREAM') { const io = IO(join(root, 'DB', 'STREAM', 'STREAM')); io.open(); return _streamProxy(io) }
  if (target === 'SHELL')  { const io = IO(join(root, 'DB', 'SHELL',  'SHELL'));  io.open(); return wrapWithCount(io) }
  if (target === 'STATE')  return openCollection(join(root, 'DB', 'STATE', 'STATE.yaml'), { type: 'yaml' })
  if (target === 'PLANS') {
    const fullPlans = join(root, 'DB', 'PLANS', 'PLANS-FULL.yaml')
    const plans = join(root, 'DB', 'PLANS', 'PLANS.yaml')
    return openCollection(plans, { type: 'dash', genesis: existsSync(fullPlans) ? 'PLANS-FULL.yaml' : undefined })
  }
  if (target === 'BACKLOG') return openCollection(join(root, 'DB', 'PLANS', 'BACKLOG', 'BACKLOG.yaml'), { type: 'yaml' })
  if (target === 'MEMORY') return openCollection(join(root, 'DB', 'MEMORY', 'memory.dash'))
  if (target === 'STORE')  return openCollection(join(root, 'DB', 'store.yaml'), { type: 'yaml' })
  if (target === 'TASKS')  return openCollection(join(root, 'DB', 'tasks.yaml'), { type: 'yaml' })

  // Unified DB Singularity Aliases (CAPS)
  // Dynamically discover CAPS from the DB/ directory
  const CAPS = DB('DB').keys().filter(k => /^[A-Z_]+$/.test(k))
  if (CAPS.includes(target)) {
    const filePath = findNamedFile(target, root)
    if (filePath) return openNamedCollection(filePath, opts)
    // Fallback to auto-discovery path if findNamedFile failed but we want to force it
    return openNamedCollection(join(root, 'DB', target, target + '.yaml'), opts)
  }

  // Global factory cache
  if (target === 'io' && !opts.path && _globalDB) return _globalDB

  // ── Case 0: Explicit backend — DB('dash', {file}) or DB('yaml', '//path') ──
  // Backward-compat: when target is a known adapter name, treat it as backend+file
  if (typeof target === 'string' && BACKENDS[target]) {
    let filePath = opts.file ?? null
    let directAccess = !!opts._direct

    // Resolve // prefix in file option
    if (filePath && typeof filePath === 'string' && filePath.startsWith('//')) {
      filePath = join(root, filePath.slice(2))
      directAccess = true
    }

    const backendFn = BACKENDS[target]
    if (filePath) ensureDir(filePath)
    const col = backendFn(filePath, opts)
    col.open()

    if (directAccess) return wrapWithCount(col)

    // Return wrapper with .kv() for backwards compat (DB('yaml', {file}).kv())
    return {
      kv: (name) => {
        if (!name) return wrapWithCount(col)
        const sep = col.sep || '/'
        return wrapWithCount({
          get: (k) => { const s = col.get(name); return k ? s?.[k] : s },
          in: (p) => {
            const mapped = {}
            for (const [k, v] of Object.entries(p)) {
              mapped[k.startsWith(name + sep) ? k : name + sep + k] = v
            }
            return wrapWithCount(col).in(mapped)
          },
          put: (p) => col.in(p),
          out: (fn) => col.out(p => p?.payload?.[name] && fn(p.payload[name])),
          flush: () => col.flush?.(),
          state: () => col.get(name),
          get size() { return wrapWithCount(col).size },
        })
      },
      resolve: (ref) => col.get(ref),
      entities: () => [{
        name: filePath, type: target, size: col.size,
        header: col.header?.(), state: col.state?.()
      }]
    }
  }

  // ── Scenario B (Factory): 'io', '//', or explicit folder 'path/' ──
  const isFactory = target === 'io' || target === '//' || (typeof target === 'string' && target.endsWith('/'))

  if (isFactory) {
    const factoryRoot = target === '//' ? '/' : (target === 'io' ? root : resolve(root, target))
    return createFactory(factoryRoot, opts)
  }

  // ── Scenario A: file path (has dot, or slash internal) ──
  const isFilePath = typeof target === 'string' && /[./\\]/.test(target)

  if (isFilePath) {
    // If target is an existing directory, treat as factory root: DB(dir, 'CollName') pattern
    const absTarget = resolve(root, target)
    if (existsSync(absTarget) && statSync(absTarget).isDirectory()) {
      const factory = createFactory(absTarget, { _direct: true, ...opts })
      if (opts.type && !BACKENDS[opts.type]) return factory.collection(opts.type)
      return factory
    }
    // Try root-relative first, then DB/-relative
    const candidates = [absTarget, resolve(root, 'DB', target)]
    const filePath = candidates.find(p => existsSync(p)) ?? candidates[0]
    return openCollection(filePath, opts)
  }

  // ── Scenario A (via name): named collection resolves to a file ──
  const filePath = findNamedFile(target, root)
  if (filePath) return openNamedCollection(filePath, opts)

  // Unknown reference → default to a named collection factory in Scenario B
  return createFactory(root, opts).collection(target)

  // ── Scenario B: namespace → factory instance ──
  return createFactory(root, opts)
}

// ── Factory Instance (Scenario B) — 11.36 §3 Entity API ─────────────────────

function createFactory(root, opts = {}) {
  const baseDir = root
  const base = (baseDir === '/' || baseDir.endsWith('/DB') || baseDir.endsWith('\\DB') || opts._direct)
    ? baseDir
    : join(baseDir, 'DB')

  const registry = new Map()
  const node = NodeAdapter(base, opts)
  node.open()

  const factory = {
    ...node, // Mixin NodeAdapter capabilities (has, get, ls, ...)

    // ── 11.36 §3 Unified Entity API ──

    /** Unified Signature: db.collection('name Backend Classes', opts) */
    collection: (sig, colOpts = {}) => {
      const { name, backend, classes } = parseSignature(sig)
      const effectiveClasses = classes.length ? classes : (sig.includes(' ') ? [] : ['yaml', 'dash'])
      const effectiveBackend = backend || colOpts.type || (effectiveClasses.includes('stream') ? 'stream' : (effectiveClasses.includes('dash') ? 'dash' : 'yaml'))

      // 1. Resolve Path & Extension
      let ext = ''
      if (effectiveBackend === 'yaml' || effectiveBackend === 'dash') ext = '.yaml'
      else if (effectiveBackend === 'lines') ext = '.txt'
      else if (effectiveBackend === 'blob') ext = '.bin'
      else if (effectiveBackend === 'folder') ext = ''
      else if (effectiveBackend === 'stream') ext = '.dash'

      const fileName = name.includes('.') ? name : (name + ext)
      const fullPath = join(base, fileName)
      ensureDir(fullPath)

      // 2. Open via Adapter
      const factoryFn = BACKENDS[effectiveBackend]
      if (!factoryFn) throw new Error(`[db] Unknown backend: ${effectiveBackend} (BACKENDS: ${Object.keys(BACKENDS)})`)
      const col = factoryFn(fullPath, { ...opts, ...colOpts, classes: effectiveClasses })
      col.open()

      // 3. Wrap Stream backend with put/settle API (entity#hash tokens)
      if (effectiveBackend === 'stream') {
        const entityName = name.replace(/\.[a-z]+$/, '')
        const origIn = col.in.bind(col)
        const put = (typeOrPatch, payload) => {
          const rec = typeof typeOrPatch === 'string' && payload !== undefined
            ? { type: typeOrPatch, ...payload }
            : typeOrPatch
          origIn(rec)
          const recs = col.records()
          const lastKey = recs.length > 0 ? Object.keys(recs[recs.length - 1])[0] : null
          return lastKey ? `${entityName}#${lastKey}` : null
        }
        col.put = put
        col.in  = put
        col.settle = (token, timeout = 30000) => {
          const ref = String(token ?? '').split('#').pop()
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`[IO] settle timeout (${timeout}ms)`)), timeout)
            const match = (recs) => recs
              .map(r => ({ key: Object.keys(r)[0], payload: Object.values(r)[0] }))
              .find(({ payload }) => payload?.type === 'result' && (payload?._prev === ref || payload?._ref === ref))
            const existing = match(col.records())
            if (existing) { clearTimeout(timer); return resolve(existing) }
            const off = col.out(({ key, payload }) => {
              if (payload?.type === 'result' && (payload?._prev === ref || payload?._ref === ref)) {
                clearTimeout(timer); off(); resolve({ key, payload })
              }
            })
          })
        }
      }

      // 4. Register for cross-collection resolve
      const registryKey = `${effectiveBackend}:${name}`
      registry.set(registryKey, col)

      return wrapWithCount(col)
    },

    /** Append-only reactive log (.dash) */
    stream: (name, o) => factory.collection(`${name} stream`, o),

    /** Merged key-value state (.yaml) */
    kv: (name, o) => factory.collection(`${name} yaml kv`, o),

    /** Merge-reduced store */
    store: (name, o) => factory.collection(`${name} yaml store`, o),

    /** Upsert-by-id table (.yaml) */
    table: (name, o) => factory.collection(`${name} yaml table`, o),

    /** JS Map mirroring */
    map: (name, o) => factory.collection(`${name} json map`, o),

    /** SQL delegation (Bun:SQLite) */
    sql: (name, o) => factory.collection(`${name} sqlite sql`, o),

    /** Probabilistic membership */
    bloom: (name, o) => factory.collection(`${name} json bloom`, o),

    /** Simple raw file (.txt) */
    file: (name, o) => factory.collection(`${name} file`, o),

    /** Line-by-line file access */
    lines: (name, o) => factory.collection(`${name} lines`, o),

    /** Sub-factory for a directory */
    folder: (name) => DB({ path: join(base, name.replace(/\/$/, '')), _direct: true }),

    /** Raw file/buffer storage — non-reactive */
    blob: (name, o) => factory.collection(`${name} blob`, o),

    // ── Legacy / Convenience ──

    agent: (id) => ({
      context: factory.store(`context.${id}`),
      store:   factory.store(`store.${id}`),
    }),

    out: (handler) => ON('io:write', (t) => handler(t.payload)),

    resolve(ref) {
      if (!ref) return undefined
      const s = String(ref)
      const hasHash = s.includes('#')
      if (!hasHash) return undefined

      const [entity, ...rest] = s.split('#')
      const key = '#' + rest.join('#')

      if (entity) {
        // 1. Try active registry (cached collections)
        for (const [k, col] of registry) {
          if (k.endsWith(':' + entity) || k === entity) return wrapWithCount(col).get(key)
        }
        // 2. Auto-discovery in DB/ folder
        try {
          const col = factory.collection(entity)
          if (col) return wrapWithCount(col).get(key)
        } catch { }
        return undefined
      }

      // 3. Naked hash search (#key) — check all active collections
      for (const col of registry.values()) {
        const v = col.get(key)
        if (v !== undefined) return v
      }
      return undefined
    },

    entities() {
      const result = []
      for (const [k, io] of registry) {
        const [type, name] = k.split(':')
        result.push({ name, type, size: io.size, header: io.header(), state: io.state() })
      }
      return result
    },

    /** Open a named collection with explicit options (template/genesis, type) */
    open: (name, colOpts = {}) => {
      const { genesis, template, type: colType = 'dash' } = colOpts
      const factoryFn = BACKENDS[colType]
      if (!factoryFn) throw new Error(`[db] Unknown collection type: ${colType}`)
      const dir = join(base, name)
      if (!existsSync(dir)) {
        try { mkdirSync(dir, { recursive: true }) } catch (e) {}
      }
      const filePath = join(dir, name + '.yaml')
      const col = factoryFn(filePath, { genesis: template || genesis })
      col.open()
      return wrapWithCount(col)
    },

    /** Resolve a named collection via DB(). Alias for .collection(name) */
    entity: (name) => {
      if (!name) return undefined
      try { return factory.collection(name) } catch { return undefined }
    },

    io: (name, typeName = 'store') => openIO(name, typeName),

    path: () => baseDir,
  }

  // Explicit path always wins; otherwise only set once
  if (!_globalDB || opts.path) _globalDB = factory
  return factory
}

DB.extensions = () => Object.keys(EXT_MAP)
DB.types = () => Object.keys(BACKENDS)

 export default DB
