import {
  existsSync, readFileSync, writeFileSync, appendFileSync,
  openSync, fstatSync, readSync, closeSync, utimesSync,
  statSync, mkdirSync, rmSync, renameSync
} from 'fs'

import { dirname, basename } from 'path'
import { stringify } from 'yaml'
import { EMIT, ON, OFF } from '../bus.js'
import { makeFullKey, shortestPrefix, verify, toBits, recoverTs, toB64 } from '../hash.js'




/**
 * io/io.js — IO Primitive (v20.26 - Universal Fractal Persistence)
 *
 * Dual-format .dash files:
 *   dash (default):  {payload}#key   — split('#') to separate
 *   jsonl:           {"key":payload} — standard JSON lines
 * Reader auto-detects per line. Writer uses `format` option.
 */

function mtime(p) { try { return Math.floor(statSync(p).mtimeMs / 100) * 100 } catch { return 0 } }


function stats(tsArray) {
  if (!tsArray.length) return { avg: 0, var: 0, count: 0 }
  const count = tsArray.length
  const avg = tsArray.reduce((prev, curr) => prev + curr, 0) / count
  const varVal = tsArray.reduce((prev, curr) => prev + Math.pow(curr - avg, 2), 0) / Math.max(1, count - 1)
  return { avg, var: varVal, count }
}



function acquireMetadataLock(f) {
  const pid = process.pid % 1000000
  const deadline = Date.now() + 5000
  
  while (Date.now() < deadline) {
    const d = mtime(f.dash), y = mtime(f.yaml)
    
    if (d === y || y === 0) {
      const now = Math.floor(Date.now() / 100) * 100
      try {
        if (!existsSync(f.yaml)) writeFileSync(f.yaml, '')
        utimesSync(f.yaml, new Date(pid), new Date(now))
        
        const stop = Date.now() + 5 + Math.random() * 10
        while (Date.now() < stop) { }
        
        const s = statSync(f.yaml)
        if (Math.floor(s.atimeMs) === pid && Math.floor(s.mtimeMs / 100) * 100 === now && mtime(f.dash) === d) {
          return now // Lock acquired
        }
      } catch { }
    }

    const stop = Date.now() + 10 + Math.random() * 20
    while (Date.now() < stop) { }
  }
  throw new Error(`[IO] Sync Lock Timeout (Race): ${f.dash}`)
}




/** Parse a .dash line → { key, payload } record. Auto-detects dash or jsonl format. */
function parseLine(line) {
  if (!line || typeof line !== 'string') return null
  line = line.trim()
  if (!line) return null

  // dash format: {payload}#key
  const hi = line.lastIndexOf('#')
  if (hi > 0 && line[0] === '{') {
    const key = line.slice(hi + 1).trim()
    if (key && !/[{}\s]/.test(key)) {
      try { return { [key]: JSON.parse(line.slice(0, hi)) } }
      catch { /* fall through to jsonl */ }
    }
  }

  // jsonl format: {"key": payload}
  try { return JSON.parse(line) }
  catch { return null }
}

/** Serialize a record to a line string (no trailing newline). */
function serializeLine(key, payload, format) {
  if (format === 'jsonl') return JSON.stringify({ [key]: payload })
  return JSON.stringify(payload) + '#' + key  // dash format
}

function readLast(path) {
  if (!existsSync(path) || statSync(path).size === 0) return null
  try {
    const fd = openSync(path, 'r'), size = fstatSync(fd).size
    const buf = Buffer.allocUnsafe(4096)
    const read = readSync(fd, buf, 0, Math.min(4096, size), Math.max(0, size - 4096))
    closeSync(fd)
    const lines = buf.subarray(0, read).toString('utf-8').split('\n').filter(Boolean)
    return parseLine(lines.at(-1))
  } catch { return null }
}

export function IO(base, { reduce, initial, log: logOverride, type, entity, format: fmt } = {}) {
  const name = entity ?? basename(base), entityType = type ?? 'kv'
  const format = fmt || 'dash'
  const hasExt = /\.[a-z0-9]+$/i.test(base)
  const f = {
    dash: logOverride || (hasExt ? base : base + '.dash'),
    yaml: logOverride ? logOverride.replace(/\.dash$/, '.yaml') : (hasExt ? base.replace(/\.[a-z0-9]+$/i, '') : base) + '.yaml',
    index: logOverride ? logOverride.replace(/\.dash$/, '.index') : (hasExt ? base.replace(/\.[a-z0-9]+$/i, '') : base) + '.index'
  }


  const _reduce = reduce ?? ((acc, rec) => Object.assign({}, acc, Object.values(rec)[0] ?? {}))
  const _initial = initial ?? (Array.isArray(initial) ? [] : {})

  let projection = Array.isArray(_initial) ? [] : { ..._initial }
  let lastSync = 0, lastOffset = 0
  let index = { records: new Set(), prefixSet: new Set(), shortMap: new Map(), fullMap: new Map(), levels: {}, global: {} }



  function saveYaml() {
    const yp = f.yaml; if (!yp) return
    const tmp = yp + '.tmp'
    try {
      writeFileSync(tmp, stringify(projection, { collectionStyle: 'block' }))
      renameSync(tmp, yp)
    } catch (e) { /* ignore write errors for now */ }
  }


  function sync(force = false) {
    const lp = f.dash; if (!lp || !existsSync(lp)) return
    const mt = mtime(lp), sz = statSync(lp).size
    if (!force && mt === lastSync && sz === lastOffset) return
    
    const fd = openSync(lp, 'r')
    const buf = Buffer.alloc(sz - lastOffset)
    readSync(fd, buf, 0, sz - lastOffset, lastOffset)
    closeSync(fd)
    
    const newContent = buf.toString('utf8')
    const newLines = newContent.split('\n').filter(Boolean)
    const newParsed = newLines.map(parseLine).filter(Boolean)
    
    projection = newParsed.reduce((acc, rec) => { try { return _reduce(acc, rec) } catch { return acc } }, projection)
    
    if (lastOffset === 0) {
      index.prefixSet.add(toBits('0')); index.prefixSet.add(toBits('1'))
      index.records.add('0'); index.records.add('1')
    }

    
    let prevPayload = index.lastPayload || null
    const timestamps = index.timestamps || []
    
    newParsed.forEach((rec) => {
      const storedKey = Object.keys(rec)[0]
      const payload = rec[storedKey]
      if (storedKey === '0' || storedKey === '1') {
        prevPayload = payload
        return
      }
      const fullKey = makeFullKey(payload, prevPayload)
      const ts = recoverTs(fullKey, payload, prevPayload)
      timestamps.push(ts)
      
      const res = { p: toB64(index.records.size), bits: toBits(toB64(index.records.size)), n: toBits(toB64(index.records.size)).length }
      
      index.records.add(fullKey)
      index.prefixSet.add(res.bits)
      index.shortMap.set(storedKey, fullKey)
      index.shortMap.set(fullKey, fullKey)
      
      const depth_actual = res.n
      const level = index.levels[depth_actual] || (index.levels[depth_actual] = { count: 0 })
      level.count++
      prevPayload = payload
    })
    
    index.lastPayload = prevPayload
    index.timestamps = timestamps
    index.global = stats(timestamps)
    lastSync = mt
    lastOffset = sz
  }


  function saveIndex() {
    if (!f.index) return
    let content = `0${JSON.stringify(index.global)}\n`
    for (const [lvl, data] of Object.entries(index.levels)) {
      content += `${lvl}${JSON.stringify({ min: data.first, max: data.last, count: data.count })}\n`
    }
    const tmp = f.index + '.tmp'
    writeFileSync(tmp, content)
    renameSync(tmp, f.index)
  }


  function writeGenesis() {
    const payload0 = { _entity: name, _type: entityType }
    const payload1 = { _projection: name }
    index.prefixSet.add(toBits('0')); index.prefixSet.add(toBits('1'))
    
    if (!existsSync(dirname(f.dash))) mkdirSync(dirname(f.dash), { recursive: true })
    const now = acquireMetadataLock(f)
    try {
      appendFileSync(f.dash, serializeLine('0', payload0, format) + '\n')
      appendFileSync(f.dash, serializeLine('1', payload1, format) + '\n')
      projection = _reduce(Array.isArray(_initial) ? [] : { ..._initial }, { '0': payload0 })
      projection = _reduce(projection, { '1': payload1 })
      
      const tmp = f.yaml + '.tmp'
      writeFileSync(tmp, stringify(projection, { collectionStyle: 'block' }))
      renameSync(tmp, f.yaml)

      saveIndex()
      
      // Unlock: equalize timestamps (trio)
      const commitTime = Math.floor(Date.now() / 100) * 100
      const d = new Date(commitTime)
      utimesSync(f.dash, d, d)
      utimesSync(f.yaml, d, d)
      utimesSync(f.index, d, d)

    } finally { }
    index.records.add('0'); index.shortMap.set('0', '0')
    index.records.add('1'); index.shortMap.set('1', '1')
  }

  function write(payload) {
    if (!existsSync(f.dash) || statSync(f.dash).size === 0) writeGenesis()
    const now = acquireMetadataLock(f)
    try {
      sync(true) 
      const last = readLast(f.dash), prev = last ? Object.values(last)[0] : null
      const fullKey = makeFullKey(payload, prev, Date.now())
      
      // Numerical Adressing for Perfect Occupancy
      const count = index.records.size
      const res = { p: toB64(count), bits: toBits(toB64(count)), n: toBits(toB64(count)).length }



      
      appendFileSync(f.dash, serializeLine(res.p, payload, format) + '\n')
      projection = _reduce(projection, { [res.p]: payload })
      
      index.prefixSet.add(res.bits)
      index.records.add(fullKey)

      index.shortMap.set(res.p, fullKey); index.shortMap.set(fullKey, fullKey)
      const fb = toBits(fullKey)
      for (let n = 1; n <= fb.length; n++) index.fullMap.set(fb.slice(0, n), fullKey)
      
      EMIT(`io:${name}`, { key: res.p, fullKey, payload })
      
      const tmp = f.yaml + '.tmp'
      writeFileSync(tmp, stringify(projection, { collectionStyle: 'block' }))
      renameSync(tmp, f.yaml)
      saveIndex()
      
      const commitTime = Math.floor(Date.now() / 100) * 100
      const d = new Date(commitTime)
      utimesSync(f.dash, d, d)
      utimesSync(f.yaml, d, d)
      utimesSync(f.index, d, d)

      return '#' + res.p
    } catch(e) { 
      process.stderr.write(`[IO ERROR] ${e.message}\n`)
      throw e 
    }

  }


  function get(ref) {
    if (ref === '#0' || ref === 0) {
      if (!existsSync(f.dash)) return undefined
      const records = readFileSync(f.dash, 'utf8').split('\n').filter(Boolean)
      const first = parseLine(records[0])
      return first ? Object.values(first)[0] : undefined
    }
    if (ref === '#1' || ref === 1 || ref == null) return projection
    
    const s = String(ref)
    const isHash = s.startsWith('#')
    const p = isHash ? s.slice(1) : s
    
    // 1. Direct property access on projection
    if (projection && typeof projection === 'object' && !Array.isArray(projection)) {
      if (p in projection) return projection[p]
    }
    
    // 2. Hash Expansion via Index
    const full = index.shortMap.get(p) || index.fullMap.get(toBits(p)) || p
    
    // Check if the expanded key is in projection
    if (projection && typeof projection === 'object' && !Array.isArray(projection)) {
      if (full in projection) return projection[full]
    }
    
    // 3. Log Scan Fallback (Ironproof)
    if (isHash) {
      const match = recs().find(r => {
        const k = Object.keys(r)[0]
        return k === p || k === full
      })
      if (match) return Object.values(match)[0]
    }
    
    return undefined
  }

  const recs = () => existsSync(f.dash) ? readFileSync(f.dash, 'utf8').split('\n').filter(Boolean).map(parseLine).filter(Boolean) : []

  return {
    open: () => { if (!existsSync(f.dash) || statSync(f.dash).size === 0) writeGenesis(); sync(true) },
    in: write,
    get,
    out: (h) => { ON(`io:${name}`, h); return () => OFF(`io:${name}`, h) },
    records: recs,
    verify: () => verify(recs()),
    header: () => get('#0'),
    state: () => get('#1'),
    find: (pred) => recs().map(r => Object.values(r)[0]).filter(pred),
    get size() { return index.records.size },
    family: f,
  }
}

export const merge = (acc, rec) => {
  const p = Object.values(rec)[0]; if (!p || typeof p !== 'object') return acc
  for (const [k, v] of Object.entries(p)) { if (v === null) delete acc[k]; else if (typeof v === 'object' && !Array.isArray(v)) acc[k] = { ...(acc[k] ?? {}), ...v }; else acc[k] = v }
  return acc
}
export const append = (acc, rec) => (acc ?? []).push ? (acc.push(rec), acc) : [rec]
export const assign = (acc, rec) => Object.assign({}, acc, Object.values(rec)[0] ?? {})

function parseFile(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(parseLine).filter(Boolean)
}

export { verify, makeFullKey, sha64 } from '../hash.js'

export default IO
