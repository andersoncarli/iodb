/**
 * paged-projection.js — feature 2.5
 *
 * The canonical projection of an IO() store, physically stored in 4K-aligned
 * text pages, presented to the engine as an ordinary object (or array) through
 * a Proxy. Only the pages a caller actually touches are held in memory, so a
 * store can exceed process RAM and still answer `get`.
 *
 * Two layouts, because the reducers are not commutative:
 *
 *   keyed       merge / assign — projection is a map. Pages hold "key\tjson"
 *               lines sorted by key. A point read pages in one page.
 *   sequential  append         — projection is an ordered list. Pages hold
 *               bare "json" lines in application order. Order is the identity;
 *               nothing is sorted.
 *
 * Persistence is synchronous (openSync/readSync/writeSync/fsyncSync) so it can
 * run inside the engine's lock critical section without reopening it.
 *
 * Page format (data pages, after the header page):
 *   keyed line       <key>\t<JSON.stringify(value)>\n
 *   sequential line  <JSON.stringify(value)>\n
 *   then filling to the 4096 boundary (spaces). The header's per-page line
 *   count is the authority on where content ends — trailing spaces an editor
 *   might trim are not load-bearing.
 *
 * Header page (page 0), a single JSON object padded to pageSize:
 *   { magic:"PAGEDPROJ", version:1, pageSize, layout, keys:[...], pages:[n,...] }
 *   keys[]  — for keyed layout, the first key of each data page (the split
 *             points); empty for sequential.
 *   pages[] — line count per data page.
 */

import {
  openSync, closeSync, readSync, writeSync, fsyncSync,
  fstatSync, existsSync, mkdirSync, renameSync, writeFileSync
} from 'fs'
import { dirname } from 'path'

const MAGIC = 'PAGEDPROJ'
const VERSION = 1
const PAGE_SIZE = 4096
const CACHE_PAGES = 64          // ~256KB resident ceiling for value pages

function encodeKeyed(key, value) {
  return key + '\t' + JSON.stringify(value) + '\n'
}
function decodeKeyed(line) {
  const tab = line.indexOf('\t')
  if (tab === -1) return null
  const key = line.slice(0, tab)
  try { return [key, JSON.parse(line.slice(tab + 1))] } catch { return null }
}
function encodeSeq(value) {
  return JSON.stringify(value) + '\n'
}
function decodeSeq(line) {
  try { return JSON.parse(line) } catch { return null }
}

function padTo(str, size) {
  const len = Buffer.byteLength(str)
  if (len > size) return null
  return str + ' '.repeat(size - len)
}

/**
 * Pack sorted "key\tjson" (or bare "json") lines into pages ≤ pageSize bytes.
 * A single line longer than a page gets its own page.
 */
function packLines(lines, pageSize) {
  const pages = []
  let cur = []
  let bytes = 0
  for (const line of lines) {
    const n = Buffer.byteLength(line)
    if (cur.length && bytes + n > pageSize) {
      pages.push(cur); cur = []; bytes = 0
    }
    cur.push(line)
    bytes += n
  }
  if (cur.length) pages.push(cur)
  return pages
}

export function PagedProjection(file, { layout = 'keyed', pageSize = PAGE_SIZE, initial } = {}) {
  const isSeq = layout === 'sequential'
  let fd = null
  let pageCounts = []            // line count per data page
  let splitKeys = []             // first key of each data page (keyed only)
  const cache = new Map()        // pageIndex -> { entries, dirty }  (LRU by insertion)
  let dirtyHeader = false

  // ---- file / header -------------------------------------------------------

  function ensureFile() {
    mkdirSync(dirname(file), { recursive: true })
    if (!existsSync(file)) {
      writeFileSync(file, headerBuffer())
    }
  }
  function openFd() { if (fd == null) fd = openSync(file, 'r+') }
  function closeFd() { if (fd != null) { closeSync(fd); fd = null } }

  function headerBuffer() {
    const body = JSON.stringify({
      magic: MAGIC, version: VERSION, pageSize, layout,
      keys: splitKeys, pages: pageCounts
    })
    const buf = Buffer.alloc(pageSize)
    buf.write(body, 0, 'utf8')
    return buf
  }

  function loadHeader() {
    openFd()
    const st = fstatSync(fd)
    if (st.size >= pageSize) {
      const buf = Buffer.alloc(pageSize)
      readSync(fd, buf, 0, pageSize, 0)
      const nul = buf.indexOf(0)
      const text = buf.toString('utf8', 0, nul === -1 ? buf.length : nul).trim()
      try {
        const h = JSON.parse(text)
        if (h.magic === MAGIC && h.version === VERSION) {
          pageCounts = h.pages || []
          splitKeys = h.keys || []
          return
        }
      } catch { /* fall through to fresh */ }
    }
    pageCounts = []
    splitKeys = []
  }

  function pageOffset(i) { return pageSize + i * pageSize }

  // ---- page cache --------------------------------------------------------

  function evictIfNeeded() {
    while (cache.size > CACHE_PAGES) {
      // oldest non-dirty entry
      let victim = null
      for (const [k, v] of cache) { if (!v.dirty) { victim = k; break } }
      if (victim == null) break        // everything dirty; keep until flush
      cache.delete(victim)
    }
  }

  function readPage(i) {
    if (cache.has(i)) return cache.get(i)
    if (i < 0 || i >= pageCounts.length) return null
    openFd()
    const st = fstatSync(fd)
    const dataBytes = st.size - pageSize
    const len = i < pageCounts.length - 1
      ? pageSize
      : Math.max(0, dataBytes - i * pageSize)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, pageOffset(i))
    const raw = buf.toString('utf8').split('\n')
    const entries = []
    let seen = 0
    for (const line of raw) {
      if (seen >= pageCounts[i]) break
      if (line === '' || line === ' ' || /^ +$/.test(line)) continue
      if (isSeq) {
        const v = decodeSeq(line)
        entries.push(v)
      } else {
        const kv = decodeKeyed(line)
        if (kv) entries.push(kv)
      }
      seen++
    }
    const entry = { entries, dirty: false }
    cache.set(i, entry)
    evictIfNeeded()
    return entry
  }

  // ---- keyed lookup ------------------------------------------------------

  /** page index whose range covers `key` (keyed layout). */
  function pageForKey(key) {
    if (pageCounts.length === 0) return -1
    // splitKeys[i] is the first key on page i; find last i with splitKeys[i] <= key
    let lo = 0, hi = splitKeys.length - 1, ans = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (splitKeys[mid] <= key) { ans = mid; lo = mid + 1 }
      else hi = mid - 1
    }
    return ans
  }

  function getKeyed(key) {
    const pi = pageForKey(key)
    if (pi < 0) return undefined
    const { entries } = readPage(pi)
    for (const [k, v] of entries) if (k === key) return v
    return undefined
  }

  function hasKeyed(key) {
    const pi = pageForKey(key)
    if (pi < 0) return false
    const { entries } = readPage(pi)
    return entries.some(([k]) => k === key)
  }

  // ---- mutation (buffered, sorted, flushed by flushPages) --------------

  // Pending mutations kept as a map so repeated writes to one key collapse.
  const pending = new Map()      // key -> value | DELETED
  const DELETED = Symbol('deleted')
  const seqPending = []          // appended values (sequential layout)

  function setKeyed(key, value) { pending.set(key, value) }
  function delKeyed(key) { pending.set(key, DELETED) }
  function pushSeq(value) { seqPending.push(value) }

  /** Materialise the full sorted key list (keyed) — O(store). Used by
   *  ownKeys / stringify only. */
  function allKeyed() {
    const merged = new Map()
    for (let i = 0; i < pageCounts.length; i++) {
      for (const [k, v] of readPage(i).entries) merged.set(k, v)
    }
    for (const [k, v] of pending) {
      if (v === DELETED) merged.delete(k)
      else merged.set(k, v)
    }
    return merged
  }

  function allSeq() {
    const out = []
    for (let i = 0; i < pageCounts.length; i++) out.push(...readPage(i).entries)
    out.push(...seqPending)
    return out
  }

  // ---- flush -----------------------------------------------------------

  function flushPages() {
    openFd()
    let lines
    if (isSeq) {
      const values = allSeq()
      lines = values.map(encodeSeq)
    } else {
      const merged = allKeyed()
      const keys = [...merged.keys()].sort()
      lines = keys.map(k => encodeKeyed(k, merged.get(k)))
    }

    const pages = packLines(lines, pageSize)
    pageCounts = pages.map(p => p.length)
    splitKeys = isSeq ? [] : pages.map(p => {
      const first = p[0]
      const tab = first.indexOf('\t')
      return tab === -1 ? first.replace(/\n$/, '') : first.slice(0, tab)
    })

    // atomic rewrite: header + every page padded to pageSize
    const tmp = `${file}.${process.pid}.tmp`
    const tfd = openSync(tmp, 'w')
    try {
      writeSync(tfd, headerBuffer(), 0, pageSize, 0)
      let pos = pageSize
      for (const p of pages) {
        const body = p.join('')
        const padded = padTo(body, pageSize) ?? body   // oversized line: no pad
        const b = Buffer.from(padded, 'utf8')
        writeSync(tfd, b, 0, b.length, pos)
        pos += b.length < pageSize ? b.length : pageSize
        // if a page overflowed pageSize (huge single value), advance by its size
        if (b.length > pageSize) pos = pageSize + Math.ceil((pos - pageSize) / 1) // keep sequential
      }
      fsyncSync(tfd)
    } finally {
      closeSync(tfd)
    }
    renameSync(tmp, file)
    closeFd()
    cache.clear()
    pending.clear()
    seqPending.length = 0
    dirtyHeader = false
  }

  // ---- lifecycle -----------------------------------------------------

  ensureFile()
  loadHeader()

  // Seed from `initial` if the file is empty and initial has content.
  if (pageCounts.length === 0 && initial && !isSeq && Object.keys(initial).length) {
    for (const [k, v] of Object.entries(initial)) pending.set(k, v)
    flushPages()
  } else if (pageCounts.length === 0 && initial && isSeq && Array.isArray(initial) && initial.length) {
    seqPending.push(...initial)
    flushPages()
  }

  // ---- the Proxy face ----------------------------------------------

  const target = isSeq ? [] : {}

  const handler = {
    get(_, prop) {
      if (prop === Symbol.iterator && isSeq) {
        return function* () { yield* allSeq() }
      }
      if (prop === '__isPagedProjection') return true
      if (prop === '__flushPages') return flushPages
      if (prop === '__allEntries') return () => isSeq ? allSeq() : allKeyed()
      if (prop === 'length' && isSeq) {
        let n = seqPending.length
        for (const c of pageCounts) n += c
        return n
      }
      if (isSeq && typeof prop === 'string' && /^\d+$/.test(prop)) {
        const idx = Number(prop)
        const all = allSeq()
        return all[idx]
      }
      if (isSeq && (prop === 'push')) {
        return (...vals) => { for (const v of vals) pushSeq(v); return this.length }
      }
      if (isSeq && (prop === 'reduce' || prop === 'map' || prop === 'filter' || prop === 'forEach' || prop === 'slice')) {
        const all = allSeq()
        return all[prop].bind(all)
      }
      if (typeof prop !== 'string') return undefined
      return getKeyed(prop)
    },
    set(_, prop, value) {
      if (isSeq && typeof prop === 'string' && /^\d+$/.test(prop)) {
        // positional assignment is rare for append; fall back to full list
        const all = allSeq()
        all[Number(prop)] = value
        seqPending.length = 0
        // rebuild pending as full replacement
        pageCounts = []
        splitKeys = []
        cache.clear()
        seqPending.push(...all)
        return true
      }
      if (typeof prop === 'string') { setKeyed(prop, value); return true }
      return true
    },
    deleteProperty(_, prop) {
      if (typeof prop === 'string') { delKeyed(prop); return true }
      return true
    },
    has(_, prop) {
      if (typeof prop !== 'string') return false
      if (pending.has(prop)) return pending.get(prop) !== DELETED
      return isSeq ? false : hasKeyed(prop)
    },
    ownKeys() {
      if (isSeq) {
        const n = handler.get(null, 'length')
        return Array.from({ length: n }, (_, i) => String(i)).concat('length')
      }
      return [...allKeyed().keys()].sort()
    },
    getOwnPropertyDescriptor(_, prop) {
      if (isSeq) {
        if (prop === 'length') return { configurable: true, enumerable: false, value: handler.get(null, 'length'), writable: true }
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          return { configurable: true, enumerable: true, value: handler.get(null, prop) }
        }
        return undefined
      }
      if (typeof prop === 'string' && (pending.has(prop) ? pending.get(prop) !== DELETED : hasKeyed(prop))) {
        return { configurable: true, enumerable: true, value: getKeyed(prop) }
      }
      return undefined
    }
  }

  return new Proxy(target, handler)
}

/** Materialise a PagedProjection (or a plain object) to a JSON-able snapshot. */
export function materialize(proj) {
  if (proj && proj.__isPagedProjection) {
    const e = proj.__allEntries()
    if (e instanceof Map) return Object.fromEntries(e)
    return e   // array
  }
  return proj
}

export default PagedProjection
