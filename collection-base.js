/**
 * io/adapters/log-collection.js — Shared engine for Z-FLOW and JSONL adapters
 *
 * All state, indexing, telemetry, and interface logic lives here.
 * Format-specific behaviour is injected via a `fmt` descriptor:
 *
 *   fmt.logPath        string | null
 *   fmt.indexPath      string | null
 *   fmt.type           'dash'
 *   fmt.formatLine     (key, patch) → string  (no trailing \n)
 *   fmt.parseLine      (line) → { key, patch }
 *   fmt.extractFromBuffer (buffer, k) → patch | null
 *   fmt.syncFile       (filePath, cache) → void
 *   fmt.loadFile       (filePath) → object
 */

import { basename, dirname, resolve, join } from 'path'
import {
  readFileSync, writeFileSync, existsSync, appendFileSync, statSync,
  openSync, readSync, closeSync, mkdirSync
} from 'fs'
import { ON, TRANSITION } from '../utils/src/bus.js'
import { shortestPrefix, makeFullKey, fromB64, nano, toBits } from './hash.js'

export function deepMerge(target, patch, sep = '/', _seen = new WeakSet()) {
  if (typeof patch !== 'object' || patch === null || _seen.has(patch)) return target
  _seen.add(patch)

  for (const [key, v] of Object.entries(patch)) {
    if (key === '_root') continue
    if (key.includes(sep)) {
      const parts = key.split(sep)
      let t = target
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i]
        if (!t[k] || typeof t[k] !== 'object') t[k] = {}
        t = t[k]
      }
      deepMerge(t, { [parts[parts.length - 1]]: v }, sep, _seen)
    } else {
      if (v === null) {
        delete target[key]
      } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        if (!target[key] || typeof target[key] !== 'object') target[key] = {}
        deepMerge(target[key], v, sep, _seen)
      } else {
        target[key] = v
      }
    }
  }
  return target
}

export function fillMissing(target, source, _seen = new WeakSet()) {
  if (typeof source !== 'object' || source === null || _seen.has(source)) return target
  _seen.add(source)

  for (const [key, value] of Object.entries(source)) {
    if (key === '_root') continue
    if (target[key] === undefined) {
      target[key] = value
    } else if (
      target[key] &&
      value &&
      typeof target[key] === 'object' &&
      typeof value === 'object' &&
      !Array.isArray(target[key]) &&
      !Array.isArray(value)
    ) {
      fillMissing(target[key], value, _seen)
    }
  }
  return target
}

globalThis.__COLLECTION_REGISTRY__ = globalThis.__COLLECTION_REGISTRY__ || new Map()
const OPEN_REGISTRY = globalThis.__COLLECTION_REGISTRY__

export function LogCollection(filePath, fmt) {
  if (!fmt) throw new Error('LogCollection requires a formatter')
  const absPath = filePath ? resolve(filePath) : null
  if (absPath && OPEN_REGISTRY.has(absPath)) return OPEN_REGISTRY.get(absPath)

  const { logPath, indexPath, type, sep = '/' } = fmt

  let bitExtents = {}, pendingWrites = 0
  let stats = { avg: 0, M2: 0, count: 0, last: Date.now() }
  let cache = fmt.loadFile('') || {}, prefixSet = new Set(), genesisHead = null, prevPayload = null

  const live = () => cache
  const emit = (payload) => TRANSITION('io:write', { entity: filePath, payload })
  const registerKey = (k) => {
    if (!k) return
    const bits = toBits(k)
    for (let i = 1; i <= bits.length; i++) prefixSet.add(bits.slice(0, i))
  }

  const appendLog = (key, patch, bitLen) => {
    if (!logPath) { syncProjection(); return }
    const dir = dirname(logPath)
    if (!existsSync(dir)) { try { mkdirSync(dir, { recursive: true }) } catch (e) { } }
    const offset = existsSync(logPath) ? statSync(logPath).size : 0
    const line = fmt.formatLine(key, patch) + '\n'
    appendFileSync(logPath, line)
    const len = Buffer.byteLength(line)

    if (!bitExtents[bitLen]) {
      bitExtents[bitLen] = { min: offset, max: offset + len, count: 1 }
    } else {
      bitExtents[bitLen].min = Math.min(bitExtents[bitLen].min, offset)
      bitExtents[bitLen].max = Math.max(bitExtents[bitLen].max, offset + len)
      bitExtents[bitLen].count++
    }

    const now = Date.now(), dt = now - stats.last
    stats.count++
    const delta = dt - stats.avg
    stats.avg += delta / stats.count
    stats.M2 += delta * (dt - stats.avg)
    stats.last = now

    const node = { key, payload: patch, classes: Object.keys(patch).filter(k => !k.startsWith('_')) }
    TRANSITION('stream:put', { entity: 'stream', key, node, prev: null })
    emit({ key, patch, offset, len, bitLen, ts: nano().toString() })
  }

  const flushIndexManifest = () => {
    if (!indexPath) return
    const levels = Object.keys(bitExtents).map(Number).sort((a, b) => a - b)
    let lines = `0${JSON.stringify({ avg: stats.avg, var: stats.count > 1 ? stats.M2 / (stats.count - 1) : 0, count: stats.count })}\n`
    for (const i of levels) {
      const ex = bitExtents[i]
      if (ex?.count > 0) lines += `${i}${JSON.stringify({ min: ex.min, max: ex.max, count: ex.count })}\n`
    }
    writeFileSync(indexPath, lines)
  }

  const rehydrateIndex = () => {
    bitExtents = {}
    if (!indexPath || !existsSync(indexPath)) return
    for (const line of readFileSync(indexPath, 'utf8').trim().split('\n')) {
      const b = line.indexOf('{')
      if (b === -1) continue
      const n = parseInt(line.slice(0, b))
      try {
        const meta = JSON.parse(line.slice(b))
        if (n === 0) stats = { avg: meta.avg, M2: meta.var * (meta.count - 1), count: meta.count, last: Date.now() }
        else bitExtents[n] = { min: meta.min, max: meta.max, count: meta.count }
      } catch { }
    }
  }

  const syncProjection = () => {
    if (!filePath) return
    fmt.syncFile(filePath, cache)
    pendingWrites = 0
  }

  const findKeyRaw = (k) => {
    if (!logPath || !existsSync(logPath)) return null
    const bitLen = fromB64(k).toString(2).length
    const ex = bitExtents[bitLen]
    if (!ex) return null
    const fd = openSync(logPath, 'r')
    const buf = Buffer.allocUnsafe(ex.max - ex.min)
    readSync(fd, buf, 0, buf.length, ex.min)
    closeSync(fd)
    return fmt.extractFromBuffer(buf, k)
  }

  const genesis = () => ({
    _entity: filePath, _type: type, _created: nano().toString()
  })

  const col = {
    open() {
      rehydrateIndex()
      if (logPath && existsSync(logPath)) {
        const recs = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
          .map(line => {
            const { key, patch } = fmt.parseLine(line)
            return { key, patch }
          })

        // Reset prefix tracking from log records
        prefixSet = new Set()
        recs.forEach(r => {
          registerKey(r.key)
          // Skip genesis header records (keys '0' and '1') and null-key structure anchors
          if (!r.key || r.key === '0' || r.key === '1') { prevPayload = r.patch; return }
          if (fmt.merge) fmt.merge(cache, r.patch)
          else deepMerge(cache, r.patch, sep)
          if (cache?._hashes) {
            for (const path of Object.keys(r.patch)) {
              if (!path.startsWith('_')) cache._hashes[path] = r.key
            }
          }
          prevPayload = r.patch
        })

        // If log is effectively empty but source projection exists, re-seed from it
        if (recs.length <= 2) {
          // Read source from #0 record's projection field, fallback to absPath
          const genesis0 = recs.find(r => r.key === '0')
          const projSrc = fmt.genesis || genesis0?.patch?.projection
          const srcFile = projSrc ? resolve(dirname(logPath), projSrc) : absPath
          if (srcFile && existsSync(srcFile)) {
            const diskCache = fmt.loadFile(srcFile) || {}
            if (Object.keys(diskCache).length > Object.keys(cache).length) {
              cache = diskCache
              appendLog('1', cache, 1); registerKey('1')
              prevPayload = cache
            }
          }
        }
        if (recs.length > 2) {
          const genesis0 = recs.find(r => r.key === '0')
          const projSrc = fmt.genesis || genesis0?.patch?.projection
          const srcFile = projSrc ? resolve(dirname(logPath), projSrc) : null
          if (srcFile && existsSync(srcFile)) {
            const diskCache = fmt.loadFile(srcFile) || {}
            fillMissing(cache, diskCache)
          }
        }
        // Reconstruct flat hash map from YAML projection if missing (dash/annotated adapters)
        if (filePath && existsSync(filePath) && (!cache._hashes || !Object.keys(cache._hashes).length)) {
          try {
            const diskRoot = fmt.loadFile(filePath)
            if (diskRoot?._hashes && Object.keys(diskRoot._hashes).length > 0) {
              if (!cache._hashes) cache._hashes = {}
              Object.assign(cache._hashes, diskRoot._hashes)
              deepMerge(cache, diskRoot, sep)
            }
          } catch { }
        }
        if (filePath && !existsSync(filePath)) syncProjection()
      } else if (filePath) {
        // Find init file: explicit genesis option, then filePath itself, then NAME-INIT.yaml
        const initFile = (() => {
          if (fmt.genesis) {
            const g = resolve(dirname(filePath), fmt.genesis)
            if (existsSync(g)) return g
          }
          if (existsSync(filePath)) return filePath
          const base = filePath.replace(/\.yaml$/, '')
          const initPath = base + '-INIT.yaml'
          if (existsSync(initPath)) return initPath
          return null
        })()

        // Load cache before appendLog — appendLog may trigger syncProjection for null-logPath adapters
        if (initFile) {
          cache = fmt.loadFile(initFile) || {}
          prevPayload = cache
        }

        const rel = (p) => p ? './' + basename(p) : null
        // #0 = source (where data was loaded from), #1 = destiny (this log file)
        appendLog('0', { projection: rel(initFile) }, 1); registerKey('0')
        appendLog('1', { projection: rel(logPath) }, 1); registerKey('1')
        genesisHead = { _type: type, _entity: filePath, _created: nano().toString(), projection: rel(initFile) }

        // Seed the log from the projection when creating a new log from an existing file.
        // fmt.seed() assimilates every addressable node, anchoring each with a hash.
        if (initFile && fmt.seed) fmt.seed(cache, (patch) => col.in(patch))
      }
      return col
    },

    get(ref) {
      if (ref === undefined || ref === null || ref === '#1' || ref === 1) return live()
      if (ref === '#0' || ref === 0) {
        if (genesisHead) return genesisHead
        if (!logPath || !existsSync(logPath)) return undefined
        const first = readFileSync(logPath, 'utf8').split('\n')[0]
        try { return fmt.parseLine(first).patch } catch { return undefined }
      }
      const s = String(ref)
      if (s.startsWith('#') && !isNaN(parseInt(s.slice(1)))) {
        const idx = parseInt(s.slice(1))
        const lines = logPath && existsSync(logPath)
          ? readFileSync(logPath, 'utf8').trim().split('\n') : []
        if (lines[idx]) try { return fmt.parseLine(lines[idx]).patch } catch { }
        return undefined
      }
      if (s.startsWith('#')) return findKeyRaw(s.slice(1))
      return s.split(sep).filter(Boolean).reduce((acc, seg) => acc?.[seg], live())
    },

    findKey: (k) => findKeyRaw(k),

    in(patch) {
      const ts = nano()
      const stringPatch = {}
      for (const [k, v] of Object.entries(patch)) stringPatch[String(k)] = v

      deepMerge(cache, stringPatch, sep)
      const { p: key, n: bitLen, bits } = shortestPrefix(makeFullKey(stringPatch, prevPayload, ts), prefixSet)
      appendLog(key, stringPatch, bitLen)
      registerKey(key)

      if (cache?._hashes) {
        for (const path of Object.keys(stringPatch)) {
          if (!path.startsWith('_')) cache._hashes[path] = key
        }
      }

      prevPayload = stringPatch
      pendingWrites++
      if (!logPath || pendingWrites > 500) { syncProjection(); flushIndexManifest() }
      emit({ key, payload: patch })
      col.lastToken = key
      return col
    },

    undo: () => {
      if (!logPath || !existsSync(logPath)) return null
      const lines = readFileSync(logPath, 'utf8').trim().split('\n')
      if (lines.length === 0) return null
      const last = lines.pop()
      writeFileSync(logPath, lines.join('\n') + (lines.length > 0 ? '\n' : ''))
      // Re-trigger rehydration to fix cache state
      cache = fmt.loadFile(absPath) || {}
      col.open()
      return last
    },
    flush: () => { syncProjection(); flushIndexManifest() },

    out(handler) {
      return ON('io:write', (t) => t.payload.entity === filePath && handler(t.payload.payload))
    },

    settle(token, timeout = 30000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          off(); reject(new Error(`Settle timeout for ${token} at ${filePath}`))
        }, timeout)

        const isDescendant = (nodeKey, ancestorKey) => {
          if (!nodeKey || !ancestorKey) return false;
          const cleanNode = nodeKey.startsWith('#') ? nodeKey.slice(1) : nodeKey;
          const cleanAnc = ancestorKey.startsWith('#') ? ancestorKey.slice(1) : ancestorKey;
          const n = col.get('#' + cleanNode);
          if (!n) return false;
          const p = n.payload || n;
          let prev = p._prev || p._p;
          if (!prev) {
            for (const k of Object.keys(p)) {
              if (p[k]?._prev) { prev = p[k]._prev; break; }
              if (p[k]?._p) { prev = p[k]._p; break; }
            }
          }
          if (globalThis._debugBus) console.log(`[desc] node: ${cleanNode}, ancestor: ${cleanAnc}, patch: ${JSON.stringify(p)}`);
          if (!prev) return false;
          const cleanPrev = prev.startsWith('#') ? prev.slice(1) : prev;
          if (cleanPrev === cleanAnc) return true;
          return isDescendant(cleanPrev, cleanAnc);
        };

        // 1. Check History
        const recs = col.records()
        for (const r of recs) {
          if (r.key && isDescendant(r.key, token)) {
             // If we found a result or a message from an AI, consider it a potential settlement point
             const p = r.patch || {};
             if (p.result || p.classes?.includes('result') || (p.from && p.from.startsWith('ai.'))) {
                clearTimeout(timer); return resolve(r.patch)
             }
          }
        }

        // 2. Future Check
        const off = col.out((patch) => {
          const key = col.lastToken;
          if (key && isDescendant(key, token)) {
             if (patch.result || patch.classes?.includes('result') || (patch.from && patch.from?.startsWith('ai.'))) {
                clearTimeout(timer); off(); resolve(patch);
             }
          }
        })
      })
    },

    records: () => {
      if (!logPath || !existsSync(logPath)) return []
      return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
        .map(line => fmt.parseLine(line))
    },

    verify: () => ({ valid: true, length: Object.keys(bitExtents).length }),
    stats: () => stats,
    header: () => col.get('#0'),
    state: () => live(),
    hasChildren: () => true,
    path: () => filePath,
    type,
    get size() {
      if (!logPath || !existsSync(logPath)) return 0
      return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).length
    }
  }

  if (filePath) OPEN_REGISTRY.set(filePath, col)
  return new Proxy(col, {
    get(t, k) {
      if (typeof k === 'symbol') return t[k]
      if (Object.prototype.hasOwnProperty.call(t, k) || typeof t[k] === 'function') return t[k]
      // Check for getters in descriptors
      const desc = Object.getOwnPropertyDescriptor(t, k)
      if (desc && desc.get) return t[k]
      
      return t.get(String(k))
    },
    set(t, k, v) { if (k in t) { t[k] = v; return true }; t.in({ [k]: v }); return true },
  })
}
