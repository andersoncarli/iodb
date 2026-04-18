/**
 * io/node.js — Universal node resolver & implementation
 *
 * Every address resolves to a node. Every node is a Collection.
 */
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, basename, dirname, resolve as pathResolve } from 'path'
import Emitter from '../../utils/src/Emitter.js'
import { TransitionBus } from './60-transition.js'
import { findProjectRoot } from '../config.js'

export const SYMBOL = Symbol('reactive')
export const NODE = Symbol('node')
export const PATH = Symbol('path')
export const INTERNAL_BAG = new WeakMap()
export const METADATA_BAG = new WeakMap()

export let SYSTEM = null // Hydrated on first boot or node('//')
const _createSystem = () => {
  if (SYSTEM) return SYSTEM
  SYSTEM = node({ _id: 'system', _type: 'root' })
  const branches = ['io', 'storage', 'stream', 'task', 'tui', 'agent', 'file', 'sys', 'plug', 'test', 'meta']
  for (const b of branches) {
    SYSTEM[b] = node({ _id: b, _type: 'branch' })
  }
  return SYSTEM
}

// ── Lazy Emitter ────────────────────────────────────────────
function getEmitter(state, self) {
  const fn = state._fn
  if (!fn._emitter) {
    Emitter.mixin(fn)
    const originalEmit = fn.emit
    fn.emit = (event, ...args) => {
      originalEmit.call(fn, event, ...args)
      if (event === 'change') {
        const parent = state.bag._parent
        if (parent && parent[NODE]) parent.emit('change', ...args)
      }
      return fn
    }
  }
  return fn
}

// ── Core Node Implementation ──────────────────────────────────
export function makeNode(init = {}) {
  const bag = {}
  const state = { bag, _subs: null, _fn: null }
  let self

  const fn = (input) => {
    if (input == null) return bag
    if (typeof input === 'string') {
       return input.split('/').reduce((cur, seg) => {
         if (seg === '' || seg === '.') return cur
         if (seg === '..') return cur._parent ?? cur
         return cur[seg]
       }, self)
    }
    if (typeof input === 'object' && !input[NODE]) {
       for (const k in input) self[k] = input[k]
       return self
    }
    return bag
  }
  state._fn = fn

  self = new Proxy(fn, {
    get(_, key) {
      if (key === NODE) return state
      if (key === Symbol.toPrimitive || key === 'toString') return () => {
        const val = bag._value
        if (val !== undefined) return (typeof val === 'object' ? JSON.stringify(val) : String(val))
        return String(bag._addr ?? bag._id ?? '')
      }
      if (typeof key === 'symbol') return undefined

      if (['on', 'off', 'emit', 'once', 'send', 'subscribers', 'removeAllListeners'].includes(key)) {
        return getEmitter(state, self)[key]
      }

      if (key === 'toJSON') return () => {
         if (typeof bag._value !== 'undefined') return bag._value;
         const out = {};
         for (const k in bag) {
           if (k.startsWith('_')) continue;
           out[k] = (bag[k] && typeof bag[k].toJSON === 'function') ? bag[k].toJSON() : bag[k];
         }
         return out;
      }

      if (key === 'to') return (fmt) => node._xf[fmt]?.to(self)
      if (key === 'exists') return (type, ...args) => {
        let addrStr = String(bag._addr ?? bag._id ?? '')
        addrStr = addrStr.replace(/\[[^\]]+:[0-9]+\]/g, '')

        // 1. Check registered plugins (they can override existence check)
        for (const plugObj of node._plug) {
          if (plugObj.exists) {
            const m = !plugObj.match || (typeof plugObj.match === 'function' ? plugObj.match(addrStr) : plugObj.match.test(addrStr))
            if (m) {
              const res = plugObj.exists(self, type, ...args)
              if (res !== undefined) return res
            }
          }
        }

        // 2. Physical Reality Bridge (Absolute Paths)
        const isAbs = addrStr.startsWith('/') || addrStr.startsWith('\\') || (addrStr.length > 2 && addrStr[1] === ':' && addrStr[2] === '\\')
        const physical = bag._path || (isAbs ? addrStr : null)

        if (type === 'file' || type === 'stream') return physical || false
        if (type === 'cwd') return (physical ? dirname(physical) : bag._cwd || false)
        return false
      }

      if (key === '_meta') {
        if (!METADATA_BAG.has(self)) METADATA_BAG.set(self, makeNode({ _id: '_meta', _parent: self }))
        return METADATA_BAG.get(self)
      }

      if (key === '..') return bag._parent ?? self
      
      // Numeric indexing
      if (typeof key === 'string' && !isNaN(key) && !key.startsWith('_')) {
        const keys = Object.keys(bag).filter(k => !k.startsWith('_'))
        const k = keys[parseInt(key)]
        if (k) return bag[k]
      }

      if (typeof key === 'string' && key.startsWith('_')) {
         if (key === '_path') {
            if (bag._path !== undefined) return bag._path
            if (!bag._parent && bag._id !== 'system') return undefined
            const p = bag._parent?._path
            return (p && p !== '//' ? p : '') + '/' + (bag._id || '')
         }
         return bag[key]
      }

      if (key in bag) return bag[key]
      if (typeof key === 'string' && ('_' + key) in bag) return bag['_' + key]

      // Branch Redirects (Plugs)
      for (const plugObj of node._plug) {
        if (plugObj.matchBranch && plugObj.matchBranch(key, self)) {
          return plugObj.resolveBranch(key, self)
        }
      }
      
      const child = makeNode({ _id: key, _parent: self })
      bag[key] = child
      return child
    },

    set(_, key, val) {
      if (typeof key === 'string' && key.startsWith('_')) {
        bag[key] = val
      } else if (val && (typeof val === 'object' || typeof val === 'function') && val[NODE]) {
        if (typeof val === 'function') val({ _id: key, _parent: self })
        bag[key] = val
      } else {
        if (val !== null && typeof val === 'object' && val.constructor === Object) {
          bag[key] = makeNode({ _id: key, _parent: self, ...val })
        } else {
          bag[key] = makeNode({ _id: key, _parent: self, _value: val })
        }
      }
      getEmitter(state, self).emit('change', { [key]: val })
      return true
    },
    has(_, key) { return key in bag },
    ownKeys() { return Object.keys(bag).filter(k => !k.startsWith('_')) },
    getOwnPropertyDescriptor(target, key) {
       if (key in bag) return { enumerable: !String(key).startsWith('_'), configurable: true, writable: true, value: bag[key] }
       return undefined
    }
  })

  INTERNAL_BAG.set(self, bag)

  if (init && typeof init === 'object' && !init[NODE]) {
    for (const k in init) {
      if (k.startsWith('_')) bag[k] = init[k]
      else self[k] = init[k]
    }
  }
  return self
}

// ── Resolver State ───────────────────────────────────────────
const INSTANCE_CACHE = new Map()
const PROXY_CACHE = new Map()

// ── The unified node() factory ────────────────────────────────
export function node(path, ...rest) {
  let result
  if (path == null) {
      result = makeNode({})
  } else if (typeof path === 'string') {
    // ── Address Qualifier Stripping ([main:3], etc.) ──────────────────────
    const Q = /\[[^\]]+:[0-9]+\]/g
    if (Q.test(path)) {
       const cleanPath = path.replace(Q, '')
       const res = node(cleanPath, ...rest)
       if (res && res[NODE]) {
         const b = res[NODE].bag
         if (!b._addr) b._addr = path
         // If it's a stream turn and it was just created, handle identification/caching
         const M = /\[(?:([^\]]+):)?([0-9]+)\]/.exec(path)
         if (M) {
            const branch = M[1] || 'main'
            const turn = M[2]
            if (!cleanPath) {
               if (!SYSTEM) return res
               return SYSTEM.stream[branch][turn]
            }
            if (b._id === cleanPath || !b._id) {
               b._id = cleanPath || turn
               b._branch = branch
            }
         }
       }
       return res
    }

    // 1. Check Root Plugins (e.g. //DB, //stream)
    for (const { re, factory } of node._roots) {
      if (re.test(path)) {
        result = factory(path)
        if (result !== undefined) break
      }
    }

    // 2. Plugin pipeline — specialized handlers match first (e.g. >, file extensions)
    if (!result) {
       for (const plugObj of node._plug) {
         if (!plugObj.parse || !plugObj.match) continue
         const m = typeof plugObj.match === 'function' ? plugObj.match(path) : plugObj.match.test(path)
         if (m) { result = plugObj.parse(path); break }
       }
       if (!result) {
         for (const { re, factory } of (node._plugs || [])) {
           if (re.test(path)) { result = factory(path); break }
         }
       }
    }

    // 3. Local/Global RESOLVE (// segment based fallback)
    if (!result && path.startsWith('//')) {
      const segments = path.slice(2).split('/').filter(Boolean)
      if (!segments.length) {
        result = _createSystem()
      } else {
        // Try system branches first
        const sys = _createSystem()
        result = segments.reduce((cur, seg) => (cur && cur[seg]) || null, sys)
        
        // If not a system branch, try as project-relative path
        if (!result) {
          const base = rest[0] || findProjectRoot()
          let curr = node(base)
          for (const s of segments) {
             if (curr && curr[s]) curr = curr[s]
             else { curr = undefined; break }
          }
          result = curr
        }
      }
    }

    // 4. Fallback: Named Node
    if (!result) result = makeNode({ _id: path })

    // Merge metadata if provided
    if (result && rest[0] && typeof rest[0] === 'object') {
       const b = result[NODE].bag
       for (const k in rest[0]) if (k.startsWith('_')) b[k] = rest[0][k]
    }
  } else if (typeof path === 'object' && path[NODE]) {
    result = path
  } else if (typeof path === 'object') {
    if (path._type || path.type) {
      const typeName = path._type || path.type
      const chain = typeName.split(':')
      let merged = { ...path }
      const resolveInheritance = (name) => {
        const def = node._def[name]
        if (!def) return []
        return [...(def.parent ? resolveInheritance(def.parent) : []), def.factory]
      }

      for (const t of chain) {
        const factories = resolveInheritance(t)
        for (const f of factories) {
          const additions = f(merged)
          if (additions && typeof additions === 'object') {
            for (const k in additions) if (!(k in merged)) merged[k] = additions[k]
          }
        }
      }
      merged._type = typeName
      result = makeNode(merged)
    } else {
      result = makeNode(path)
    }
  }

  // Variadic absorption
  for (const arg of rest) {
    if (arg == null || typeof arg === 'string') continue
    if (typeof arg === 'object' && arg[NODE]) {
      result[arg()._id || ''] = arg
    } else if (typeof arg === 'object') {
      result(arg)  // merge
    }
  }

  return result
}

function resolveSegments(segments, base) {
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (seg === '.') continue
    const abs = pathResolve(base, seg)

    if (INSTANCE_CACHE.has(abs)) {
      const entity = INSTANCE_CACHE.get(abs)
      const remaining = segments.slice(i + 1)
      if (!remaining.length) return entityProxy(entity)
      return navigateInto(entity, remaining)
    }

    if (existsSync(abs) && statSync(abs).isDirectory()) {
      base = abs; continue
    }

    for (const { re, factory } of node._plugs) {
      if (re.test(seg)) {
        const entity = factory(abs)
        if (entity) {
          entity.open?.()
          INSTANCE_CACHE.set(abs, entity)
          const remaining = segments.slice(i + 1)
          if (!remaining.length) return entityProxy(entity)
          return navigateInto(entity, remaining)
        }
      }
    }
    return undefined
  }
  return undefined
}

function navigateInto(entity, remaining) {
  const key = remaining.join('/')
  const value = entity.get?.(key)
  if (value === undefined) return undefined
  if (value && typeof value === 'object') return (typeof value.kv === 'function') ? entityProxy(value) : objectProxy(value, entity, key)
  return value
}

// ── Proxies for Collections ───────────────────────────────────
export function entityProxy(entity) {
  if (PROXY_CACHE.has(entity)) return PROXY_CACHE.get(entity)
  const fn = (...args) => {
    if (args.length === 0) return entity
    if (typeof entity.get === 'function') return entity.get(...args)
    return entity
  }
  const proxy = new Proxy(fn, {
    get(_, k) {
      if (k === NODE) return { bag: { _id: entity.id || 'entity', _path: (typeof entity.path === 'function' ? entity.path() : entity.path) || '', _type: entity.type } }
      if (k === 'toString') return () => {
        const val = entity.get ? entity.get() : undefined
        if (val !== undefined && val !== entity) return (typeof val === 'object' ? JSON.stringify(val) : String(val))
        return entity._addr || entity.id || (typeof entity.path === 'function' ? entity.path() : entity.path) || 'entity'
      }
      if (typeof k === 'symbol') return entity[k]
      if (k === 'rm') return (...args) => entity.rm?.(...args)
      if (k === 'on') return (...args) => entity.on?.(...args)
      if (k === 'to') return (fmt) => node._xf[fmt]?.to(proxy)
      if (k === 'exists') return (type, ...args) => {
        const addrStr = String(entity._addr || entity.id || '')
        for (const plugObj of node._plug) {
          if (plugObj.exists) {
            const m = !plugObj.match || (typeof plugObj.match === 'function' ? plugObj.match(addrStr) : plugObj.match.test(addrStr))
            if (m) {
              const res = plugObj.exists(proxy, type, ...args)
              if (res !== undefined) return res
            }
          }
        }
        if (type === 'file' || type === 'stream') return (typeof entity.path === 'function' ? entity.path() : entity.path) || false
        return false
      }
      if (k in entity) return entity[k]
      if (typeof k === 'string' && k.startsWith('_') && entity[k] !== undefined) return entity[k]
      const s = String(k)
      if (s === 'length') return entity.size ?? (entity.keys?.()?.length) ?? 0
      const v = entity.get?.(s)
      if (v !== undefined) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          // If v looks like an adapter (has open, in, get), use entityProxy
          if ((typeof v.get === 'function' || typeof v.in === 'function') && !v.constructor?.name?.includes('Object')) {
            return entityProxy(v)
          }
          return objectProxy(v, entity, k)
        }
        return v
      }
    },
    set(_, k, v) {
      if (typeof k === 'string' && k.startsWith('_')) { entity[k] = v; return true }
      if (k in entity) { entity[k] = v; return true }
      if (typeof entity.in === 'function') { entity.in({ [k]: v }); return true }
      return false
    },
    ownKeys() {
      const keys = new Set(Object.keys(entity))
      if (typeof entity.keys === 'function') entity.keys().forEach(k => keys.add(k))
      // Proxy requirement: all non-configurable properties must be in ownKeys
      const targetProps = Object.getOwnPropertyNames(fn)
      for (const p of targetProps) keys.add(p)
      return Array.from(keys).filter(k => !k.startsWith('_'))
    },
    getOwnPropertyDescriptor(target, key) {
      if (key in entity) return { enumerable: !String(key).startsWith('_'), configurable: true, writable: true, value: entity[key] }
      const desc = Object.getOwnPropertyDescriptor(fn, key)
      if (desc) return desc
      return undefined
    }
  })
  PROXY_CACHE.set(entity, proxy)
  return proxy
}

function objectProxy(obj, entity, path) {
  return new Proxy(obj, {
    get(t, k) {
      if (k === NODE) return { bag: { _id: String(path).split('/').pop(), _value: t } }
      if (k === 'exists') return () => false
      if (typeof k === 'symbol') return t[k]
      if (k === 'toString') return () => (typeof t === 'object' ? JSON.stringify(t) : String(t))
      if (k === 'in') return (v) => entity.in?.({ [path]: { ...t, ...v } })
      if (k === 'get') return (sub) => sub ? t[sub] : t
      const s = String(k)
      if (s === 'length') return Object.keys(t).length
      if (k in t) {
        const v = t[k]
        if (v && typeof v === 'object' && !Array.isArray(v)) return objectProxy(v, entity, `${path}/${k}`)
        return v
      }
      return undefined
    },
    set(t, k, v) {
      t[k] = v
      if (typeof entity.in === 'function') entity.in({ [path + '/' + k]: v })
      return true
    },
    ownKeys(t) { 
      return Reflect.ownKeys(t).filter(k => !String(k).startsWith('_'))
    },
    getOwnPropertyDescriptor(t, k) {
      const desc = Object.getOwnPropertyDescriptor(t, k)
      if (desc) return { ...desc, enumerable: !String(k).startsWith('_'), configurable: true }
      return undefined
    }
  })
}

// ── Registries & Static APIs ────────────────────────────────
node._roots = []
node._plugs = []
node._plug  = []
node._def   = {}
node._xf    = {}

export function _resetPlugins() {
  node._roots.length = 0; node._plugs.length = 0; node._plug.length = 0;
  node._def = {}; node._xf = {}; INSTANCE_CACHE.clear(); PROXY_CACHE.clear()
}

export function plug(name, handler) {
  if (typeof handler === 'object' && handler.match) {
    const existing = node._plug.findIndex(p => p.name === name)
    const p = { name, ...handler }
    if (existing !== -1) node._plug[existing] = p
    else node._plug.push(p)
  } else {
    node._plugs.push({ re: name instanceof RegExp ? name : new RegExp(name), factory: handler })
  }
}
node.plug = plug

export function plugRoot(pattern, factory) {
  node._roots.push({ re: pattern instanceof RegExp ? pattern : new RegExp(pattern), factory })
}
node.plugRoot = plugRoot

export function define(signature, factory) { 
  const [name, parent] = signature.split(':')
  node._def[name] = { factory, parent }
}
node.define = define

export function transformer(name, io) { node._xf[name] = io }
node.transformer = transformer

export function from(format, source) {
  if (Object.keys(node._xf || {}).length === 0 && _DB) {
     registerAll(_DB, (t, p) => p, (e, h) => h)
  }
  const xf = node._xf?.[format]
  if (!xf?.from) throw new Error(`No transformer '${format}' with from() (Total: ${Object.keys(node._xf || {}).join(',')})`)
  return xf.from(source)
}
node.from = from

let _DB = null
export function registerFilePlugins(DB_factory) {
  _DB = DB_factory
  const exts = _DB.extensions ? _DB.extensions() : ['yaml', 'json', 'dash', 'jsonl']
  for (const ext of exts) {
    node.plug(new RegExp(`\\.${ext}$`), (file) => nodeResolved(file))
  }
}

function nodeResolved(file) {
  if (!_DB) return null
  const cleanFile = file.startsWith('//') ? file.slice(2) : file
  const adapter = _DB(cleanFile, { _direct: true })
  if (adapter && adapter.open) adapter.open()
  return adapter ? entityProxy(adapter) : null
}

export function registerCorePlugins(TRANSITION_fn, ON_fn) {
  const bus = TransitionBus(TRANSITION_fn, ON_fn)
  node.plugRoot(/^\/\/transition(\/|$)/, (path) => {
    const rest = path.slice('//transition'.length).replace(/^\//, '').split('/').filter(Boolean)
    if (!rest.length) return entityProxy(bus)
    return navigateInto(bus, rest)
  })
}

export function registerDBPlugin(db_factory) {
  node.plugRoot(/^\/\/DB(\/|$)/, (path) => {
    const segments = path.slice(4).split('/').filter(Boolean)
    if (!segments.length) return SYSTEM.io
    const [name, ...rest] = segments
    const col = db_factory(name, { _direct: true })
    if (!rest.length) return entityProxy(col)
    return navigateInto(col, rest)
  })
}

export function registerWorkerPlugin(dbInstance) {
  const io = (typeof dbInstance === 'function') ? dbInstance('io') : dbInstance
  node.plugRoot(/^\/\/worker(\/|$)/, (path) => {
    const id = path.replace(/^\/\/worker\/?/, '').split('/')[0]
    if (!id) return null
    const ag = io.agent(id)
    return entityProxy({ ...ag.store, id, ...ag.context })
  })
}

export function registerTaskPlugin(dbInstance) {
  const io = (typeof dbInstance === 'function') ? dbInstance('io') : dbInstance
  const tasks = io.store('tasks')
  const TASK_CACHE = new Map()
  const resolveTask = (path) => {
    const key = path.replace(/^>/, '').replace(/^\/\/task\//, '').replace(/>/g, '/')
    if (TASK_CACHE.has(key)) return TASK_CACHE.get(key)
    const prefix = `task:${key}`
    const leaf = key.split('/').pop()
    const task = {
      _id: leaf, _path: key, open: () => task,
      complete: () => task.in({ status: 'complete' }),
      get: (k) => { const s = tasks.get(prefix) ?? {}; return k ? s[k] : s },
      in: (patch) => tasks.in({ [prefix]: { ...(tasks.get(prefix) ?? {}), ...patch } }),
    }
    const proxy = entityProxy(task)
    TASK_CACHE.set(key, proxy)
    return proxy
  }
  node.plug('task', {
    match: /^>/,
    parse: resolveTask,
    matchBranch: (key, parent) => key === 'task' || (parent && parent[NODE]?.bag?._id === 'task'),
    resolveBranch: (key, parent) => {
       if (key === 'task') return SYSTEM.task
       return resolveTask(key)
    }
  })
}

export function registerAll(DB, TRANSITION, ON) {
  _DB = DB

  // 1. Core Hierarchy
  node.define('ls', () => ({ _hasChildren: true }))
  node.define('dir:ls', () => ({}))
  node.define('folder:dir', () => ({}))
  node.define('directory:dir', () => ({}))
  node.define('list:ls', () => ({}))

  node.define('kv', (spec) => ({ _type: 'yaml', ...spec }))
  node.define('store:kv', () => ({}))
  node.define('table:store', () => ({}))
  node.define('map:json', () => ({}))
  node.define('flux:dash', () => ({}))

  // 2. Primitive behaviors
  node.define('reactive', () => ({ _emitter: true }))
  node.define('memory', (spec) => ({ _persist: spec?.path || null }))
  node.define('stream', (spec) => ({ _append: spec?.path || null }))
  node.define('task', () => ({
    _lifecycle: true,
    complete() { this._state = { status: 'done', completed: Date.now() } }
  }))
  node.define('pixel', () => ({ _render: true, _layout: true }))
  node.define('agent', (spec) => ({ _agentId: spec?.agentId || null, _type: 'agent' }))
  node.define('context', (spec) => ({ _file: spec?.file || 'context.md', _type: 'context' }))

  // 2. Transformers
  node.transformer('json', {
    to(n) {
      const bag = n()
      const children = Object.keys(bag).filter(k => !k.startsWith('_'))
      if (children.length === 0 && bag._value !== undefined) return JSON.stringify(bag._value)
      const clean = {}
      for (const k of children) {
        const v = bag[k]
        if (typeof v === 'function' && v[NODE]) clean[k] = JSON.parse(node._xf.json.to(v))
        else clean[k] = v
      }
      if (children.length > 0) {
        if (bag._value !== undefined) clean._value = bag._value
        if (bag._state !== undefined) clean._state = bag._state
      }
      return JSON.stringify(clean)
    },
    from(s) {
      const data = typeof s === 'string' ? JSON.parse(s) : s
      return node(data)
    }
  })

  node.transformer('shrink', {
    to(n) {
      const bag = n()
      const out = {}
      for (const k in bag) {
        if (k.startsWith('_') && k !== '_id' && k !== '_type') continue
        const v = bag[k]
        if (typeof v === 'function' && v[NODE]) {
          const child = node._xf.shrink.to(v)
          if (child !== '{}') out[k] = JSON.parse(child)
        } else if (typeof v !== 'function') out[k] = v
      }
      return JSON.stringify(out)
    }
  })

  // 3. Plugins
  registerCorePlugins(TRANSITION, ON)
  registerDBPlugin(_DB) // Use the captured _DB
  registerTaskPlugin(_DB)
  registerFilePlugins(_DB)

  // 4. Global System Hydration (after plugins)
  const sys = _createSystem()
  sys.sys({ env: process.env, cwd: process.cwd(), pid: process.pid, platform: process.platform })
  sys.plug.address = node._plug
  if (node._xf) sys.plug.xf = Object.keys(node._xf)
}

export default node
