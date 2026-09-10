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
 * Since feature 2.0 this module owns NO storage. It is a CODEC plus a key
 * index plus the engine's Proxy face, over a PagedText store — the project's
 * single paged-storage primitive. It no longer opens an fd, computes an offset,
 * pads a page or renames a file; PagedText does that, and does it by writing
 * only the pages that actually changed.
 *
 * What stays here is what is genuinely about projections:
 *   - the codec: "<key>\t<json>" for keyed, bare "<json>" for sequential;
 *   - the key index (splitKeys) and the binary search over it;
 *   - tombstone semantics and the pending change-set;
 *   - the Proxy the engine consumes.
 */

import { PagedText } from '../pagedtext/pagedtext.js'

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



/**
 * Pack lines into pages of at most `pageSize` bytes. A line longer than a page
 * gets its own page. This mirrors what the store does internally; the codec
 * needs it to know which pages a new content WOULD occupy before writing.
 */
function packLines(lines, pageSize) {
  const pages = []
  let cur = []
  let bytes = 0
  for (const line of lines) {
    const n = Buffer.byteLength(line) + 1
    if (cur.length && bytes + n > pageSize) { pages.push(cur); cur = []; bytes = 0 }
    cur.push(line)
    bytes += n
  }
  if (cur.length) pages.push(cur)
  return pages
}

export function PagedProjection(file, { layout = 'keyed', pageSize = PAGE_SIZE, initial } = {}) {
  const isSeq = layout === 'sequential'

  // The storage primitive. Everything physical — header, offsets, page cache
  // with a ceiling, the dirty set and the positional commit — belongs to it.
  const store = PagedText(file, {
    pageSize, layout, kind: 'text', cachePages: CACHE_PAGES
  })._store

  // splitKeys travels in the shared header, but its MEANING is codec-local:
  // storage has no idea what a key is.
  let splitKeys = store.keys || []

  function pageCount() { return store.pageCount() }

  /** Decode one data page into projection entries. The store hands back logical
   *  lines; this turns them into [key, value] pairs (or bare values). */
  function pageEntries(i) {
    const lines = store.readPage(i)
    if (!lines) return []
    const entries = []
    for (const line of lines) {
      if (line === '' || /^ +$/.test(line)) continue
      if (isSeq) {
        entries.push(decodeSeq(line))
      } else {
        const kv = decodeKeyed(line)
        if (kv) entries.push(kv)
      }
    }
    return entries
  }

  // ---- keyed lookup ------------------------------------------------------

  /** page index whose range covers `key` (keyed layout). */
  function pageForKey(key) {
    if (pageCount() === 0) return -1
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
    const entries = pageEntries(pi)
    for (const [k, v] of entries) if (k === key) return v
    return undefined
  }

  function hasKeyed(key) {
    const pi = pageForKey(key)
    if (pi < 0) return false
    const entries = pageEntries(pi)
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
    for (let i = 0; i < pageCount(); i++) {
      for (const [k, v] of pageEntries(i)) merged.set(k, v)
    }
    for (const [k, v] of pending) {
      if (v === DELETED) merged.delete(k)
      else merged.set(k, v)
    }
    return merged
  }

  function allSeq() {
    const out = []
    for (let i = 0; i < pageCount(); i++) out.push(...pageEntries(i))
    out.push(...seqPending)
    return out
  }

  // ---- flush -----------------------------------------------------------

  /**
   * Hand the store a new logical content, but touch only the pages that changed.
   *
   * The pages are compared position by position. An edit that does not change
   * the page count leaves every untouched page clean, so the store writes just
   * the ones that moved. When the count changes (a page split or merged), every
   * page from that point on genuinely shifts and is rewritten — which is the
   * honest cost, not a regression.
   */
  function replacePagesDiffed(logical) {
    const wanted = logical.length ? packLines(logical, pageSize) : []
    const have = store.pageCount()

    if (wanted.length !== have) { store.replaceAll(logical); return }

    for (let i = 0; i < wanted.length; i++) {
      const current = store.readPage(i)
      const next = wanted[i]
      if (current.length === next.length && current.every((l, j) => l === next[j])) continue
      store.writePage(i, next)
    }
  }

  /**
   * Commit the pending change-set.
   *
   * The re-render of the LINES walks the whole logical content, and it has to:
   * a keyed projection is sorted, so inserting one key can shift every later
   * one across page boundaries. That part is O(store) by nature.
   *
   * What must NOT be O(store) is the WRITE. `replaceAll` would mark every page
   * dirty and hand the store a full rewrite, which throws away exactly what
   * feature 2.0 bought — measured, that made cost per write grow 15.7x as the
   * file grew 13.5x. So the new page contents are diffed against what is
   * already on disk, and only the pages that actually differ are handed over.
   * The store then writes those, plus the header.
   */
  function flushPages() {
    let lines
    if (isSeq) {
      lines = allSeq().map(encodeSeq)
    } else {
      const merged = allKeyed()
      lines = [...merged.keys()].sort().map(k => encodeKeyed(k, merged.get(k)))
    }
    // The codec's lines carry their own trailing newline; the store's logical
    // unit is a line WITHOUT one.
    const logical = lines.map(l => l.replace(/\n$/, ''))

    replacePagesDiffed(logical)

    // Recompute the split keys from what the store actually paged, then hand
    // them to the header. Storage carries them; only this module reads them.
    splitKeys = isSeq ? [] : Array.from({ length: store.pageCount() }, (_, i) => {
      const first = store.readPage(i)?.[0] ?? ''
      const tab = first.indexOf('\t')
      return tab === -1 ? first : first.slice(0, tab)
    })
    store.keys = splitKeys
    store.flush()

    pending.clear()
    seqPending.length = 0
  }

  // ---- lifecycle -----------------------------------------------------

  // Seed from `initial` if the file is empty and initial has content.
  if (pageCount() === 0 && initial && !isSeq && Object.keys(initial).length) {
    for (const [k, v] of Object.entries(initial)) pending.set(k, v)
    flushPages()
  } else if (pageCount() === 0 && initial && isSeq && Array.isArray(initial) && initial.length) {
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
        for (let i = 0; i < pageCount(); i++) n += store.readPage(i).length
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
        splitKeys = []
        store.replaceAll([])
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
