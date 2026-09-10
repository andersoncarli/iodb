import {
  openSync, closeSync, readSync, writeSync, fsyncSync, ftruncateSync,
  fstatSync, existsSync, mkdirSync, renameSync, readFileSync, writeFileSync
} from 'node:fs'
import path from 'node:path'

/**
 * PagedText — a large text file as a logical line sequence, physically stored
 * in fixed-size pages.
 *
 * v0.2 (sprint 013): synchronous page core.
 *
 *   - page 0 is a VERSIONED HEADER: magic + version + pageSize + layout +
 *     per-page line counts. A file whose header we do not recognise is not
 *     parsed — the caller rebuilds from its own source of truth.
 *   - data pages start at offset pageSize and are 4096-aligned (default);
 *     page i lives at byte (1 + i) * pageSize and is written with a positioned
 *     writeSync, so only the dirty page pays.
 *   - the page cache holds only VISITED pages, not the whole file. Identity of
 *     a page is its position in the logical sequence, never its byte offset
 *     (inserting into an early page shifts every later offset).
 *   - filling ("ws" default, "comment" explicit) is physical capacity inside a
 *     page. It never appears in the logical API. The authority on where a page
 *     ends is the header's line count, not a run of spaces an editor might trim.
 *
 * The public interface is unchanged from v0: array-of-lines access, cursor,
 * atomic flush, pages().
 */

const MAGIC = 'PAGEDTEXT'
const HEADER_VERSION = 2
const DEFAULT_PAGE_SIZE = 4096
const indexKey = p => typeof p === 'string' && /^(0|[1-9]\d*)$/.test(p)

const builtinKinds = {
  clike: {
    fill: () => ' \n',
    commentFill: () => '//- pagedtext filling\n',
    isFill: line => line.trimStart().startsWith('//- pagedtext filling') || line === ' '
  },
  text: {
    fill: () => ' \n',
    commentFill: () => '#- pagedtext filling\n',
    isFill: line => line.trimStart().startsWith('#- pagedtext filling') || line === ' '
  }
}

function kindOf(kind, filling = 'ws') {
  if (!kind) kind = 'text'
  if (typeof kind === 'string') {
    const k = builtinKinds[kind]
    if (!k) throw new Error(`Unknown kind: ${kind}`)
    return { ...k, fillMode: filling, fill: filling === 'comment' ? k.commentFill : k.fill }
  }
  return kind
}

function stripFill(lines, kind) {
  return lines.filter(line => !kind.isFill(line))
}

function joinLines(lines) {
  return lines.length ? lines.join('\n') + '\n' : ''
}

/**
 * Pack a flat line array into pages, each ≤ pageSize bytes of content.
 * A line longer than pageSize gets its own page (a split would corrupt it).
 */
function packPages(lines, pageSize) {
  const pages = []
  let page = []
  let bytes = 0
  for (const line of lines) {
    const n = Buffer.byteLength(line) + 1
    if (page.length && bytes + n > pageSize) {
      pages.push(page)
      page = []
      bytes = 0
    }
    page.push(line)
    bytes += n
  }
  if (page.length) pages.push(page)
  return pages.length ? pages : [[]]
}

/**
 * Render one data page: the content lines, then filling up to pageSize so the
 * next page starts exactly at a pageSize boundary. The header's line count is
 * what marks the real end; the filling is padding, not a terminator.
 */
function renderPage(lines, kind, pageSize) {
  let out = joinLines(lines)
  let free = pageSize - Buffer.byteLength(out)
  if (free < 0) {
    // Oversized single line: the page is exactly this line + newline, no room
    // for filling. The header records 1 line and the reader takes the page
    // boundary from the byte length it stored.
    return Buffer.from(out, 'utf8')
  }
  const unit = kind.fill()
  const unitLen = Buffer.byteLength(unit)
  while (free >= unitLen) {
    out += unit
    free -= unitLen
  }
  if (free > 0) out += ' '.repeat(free)
  return Buffer.from(out, 'utf8')
}

function serializeHeader(meta, pageSize) {
  const body = JSON.stringify({
    magic: MAGIC,
    version: HEADER_VERSION,
    pageSize,
    layout: meta.layout || 'sequential',
    pages: meta.counts   // line count per data page
  })
  const buf = Buffer.alloc(pageSize)
  buf.write(body, 0, 'utf8')
  return buf
}

function parseHeader(buf) {
  const nul = buf.indexOf(0)
  const text = buf.toString('utf8', 0, nul === -1 ? buf.length : nul).trim()
  if (!text) return null
  let h
  try { h = JSON.parse(text) } catch { return null }
  if (h.magic !== MAGIC || h.version !== HEADER_VERSION) return null
  if (!Array.isArray(h.pages)) return null
  return h
}

function atomicReplace(file, buffers) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const fd = openSync(tmp, 'w')
  try {
    let pos = 0
    for (const b of buffers) {
      writeSync(fd, b, 0, b.length, pos)
      pos += b.length
    }
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, file)
}

/**
 * The synchronous page store. Owns the fd, the header, and the visited-page
 * cache. Reads a page on demand; writes only dirty pages positioned by index.
 */
function makeStore(file, kind, pageSize, layout) {
  let fd = null
  let counts = []            // line count per data page (from header)
  let byteLens = []          // byte length actually stored per data page
  const cache = new Map()    // pageIndex -> { lines: string[], dirty: bool }
  let headerLayout = layout

  function ensureFile() {
    mkdirSync(path.dirname(file), { recursive: true })
    if (!existsSync(file)) {
      const header = serializeHeader({ layout, counts: [] }, pageSize)
      writeFileSync(file, header)
    }
  }

  function openFd() {
    if (fd == null) fd = openSync(file, 'r+')
  }

  function loadHeader() {
    openFd()
    const buf = Buffer.alloc(pageSize)
    readSync(fd, buf, 0, pageSize, 0)
    const h = parseHeader(buf)
    if (h) {
      counts = h.pages.slice()
      headerLayout = h.layout || layout
      // Recover byte lengths from file size: every data page but the last is a
      // full pageSize; the last is whatever remains.
      const st = fstatSync(fd)
      const dataBytes = st.size - pageSize
      byteLens = counts.map((_, i) =>
        i < counts.length - 1 ? pageSize : Math.max(0, dataBytes - i * pageSize))
      return true
    }
    // Unrecognised header. Either a fresh empty file, or legacy plain text with
    // no PagedText header. Any non-empty content is treated as legacy: read it
    // all, split, repage, and write the header. This is the one O(file) path,
    // taken once per file.
    const st = fstatSync(fd)
    if (st.size > 0) {
      const raw = Buffer.alloc(st.size)
      readSync(fd, raw, 0, st.size, 0)
      const lines = raw.toString('utf8').replace(/\r\n/g, '\n').split('\n')
      if (lines.at(-1) === '') lines.pop()
      const clean = stripFill(lines, kind)
      const pages = packPages(clean, pageSize)
      counts = pages.map(p => p.length)
      byteLens = pages.map(() => pageSize)
      pages.forEach((p, i) => cache.set(i, { lines: p, dirty: true }))
      flush()
      return true
    }
    counts = []
    byteLens = []
    return true
  }

  function pageOffset(i) {
    return pageSize + i * pageSize
  }

  function readPage(i) {
    if (cache.has(i)) return cache.get(i).lines
    if (i < 0 || i >= counts.length) return null
    openFd()
    const len = byteLens[i] || pageSize
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, pageOffset(i))
    let lines = buf.toString('utf8').replace(/\r\n/g, '\n').split('\n')
    if (lines.at(-1) === '') lines.pop()
    lines = stripFill(lines, kind).slice(0, counts[i])
    cache.set(i, { lines, dirty: false })
    return lines
  }

  function pageCount() { return counts.length }

  function totalLines() {
    let n = 0
    for (let i = 0; i < counts.length; i++) {
      n += cache.has(i) ? cache.get(i).lines.length : counts[i]
    }
    return n
  }

  /** Materialise every logical line (cache-aware). O(file) — callers that can
   *  work page-local should. */
  function allLines() {
    const out = []
    for (let i = 0; i < counts.length; i++) out.push(...readPage(i))
    return out
  }

  /** Locate the page and in-page offset of a global logical index. */
  function locate(globalIdx) {
    let acc = 0
    for (let i = 0; i < counts.length; i++) {
      const n = cache.has(i) ? cache.get(i).lines.length : counts[i]
      if (globalIdx < acc + n) return { page: i, local: globalIdx - acc }
      acc += n
    }
    return { page: counts.length, local: 0 }   // past the end
  }

  function lineAt(globalIdx) {
    if (globalIdx < 0) globalIdx += totalLines()
    const { page, local } = locate(globalIdx)
    const lines = readPage(page)
    return lines ? lines[local] : undefined
  }

  /** Replace the entire logical content, repage, and persist atomically. */
  function replaceAll(lines) {
    const clean = stripFill(lines, kind)
    const pages = packPages(clean, pageSize)
    cache.clear()
    counts = pages.map(p => p.length)
    byteLens = pages.map(() => pageSize)
    pages.forEach((p, i) => cache.set(i, { lines: p, dirty: true }))
    flush()
  }

  /** Write dirty pages + header. Full rewrite for now (v0.2); region-level
   *  commit is a later step. Kept atomic via temp + fsync + rename. */
  function flush() {
    openFd()
    const buffers = []
    const newCounts = []
    for (let i = 0; i < counts.length; i++) {
      const lines = readPage(i)
      newCounts.push(lines.length)
      buffers.push(renderPage(lines, kind, pageSize))
    }
    counts = newCounts
    const header = serializeHeader({ layout: headerLayout, counts }, pageSize)
    atomicReplace(file, [header, ...buffers])
    closeSync(fd)
    fd = null
    byteLens = counts.map((_, i) =>
      i < counts.length - 1 ? pageSize : Buffer.byteLength(joinLines(readPageCached(i))))
    for (const [, entry] of cache) entry.dirty = false
  }

  function readPageCached(i) {
    return cache.has(i) ? cache.get(i).lines : []
  }

  function pagesInfo() {
    const info = []
    for (let i = 0; i < counts.length; i++) {
      const lines = readPage(i)
      info.push({
        index: i,
        lines: lines.length,
        bytes: Buffer.byteLength(joinLines(lines)),
        offset: pageOffset(i),
        aligned: pageOffset(i) % pageSize === 0
      })
    }
    return info
  }

  function close() {
    if (fd != null) { closeSync(fd); fd = null }
  }

  ensureFile()
  loadHeader()

  return {
    get layout() { return headerLayout },
    pageCount, totalLines, allLines, lineAt, replaceAll, flush,
    pagesInfo, close, readPage, _cache: cache
  }
}

function makeCursor(owner, start = 0, initial = null) {
  let lines = initial ? initial.slice() : owner._snapshot()
  let pos = Math.max(0, Math.min(start, lines.length))
  let dirty = !!initial

  const cursor = {
    get pos() { return pos },
    get length() { return lines.length },
    get dirty() { return dirty },
    tell() { return pos },
    seek(n) {
      if (!Number.isInteger(n)) throw new TypeError('cursor position must be an integer')
      pos = Math.max(0, Math.min(n, lines.length))
      return cursor
    },
    next(n = 1) { return cursor.seek(pos + n) },
    prev(n = 1) { return cursor.seek(pos - n) },
    read(n = 1) {
      const out = lines.slice(pos, pos + n)
      pos = Math.min(lines.length, pos + n)
      return n === 1 ? out[0] : out
    },
    peek(n = 1) {
      const out = lines.slice(pos, pos + n)
      return n === 1 ? out[0] : out
    },
    insert(...values) {
      const a = values.flat()
      lines.splice(pos, 0, ...a)
      pos += a.length
      dirty = true
      return cursor
    },
    write(...values) {
      const a = values.flat()
      lines.splice(pos, a.length, ...a)
      pos += a.length
      dirty = true
      return cursor
    },
    overwrite(value) { return cursor.write(value) },
    delete(n = 1) {
      lines.splice(pos, n)
      dirty = true
      return cursor
    },
    replace(n, ...values) {
      const a = values.flat()
      lines.splice(pos, n, ...a)
      pos += a.length
      dirty = true
      return cursor
    },
    save() {
      return owner._saveCursor({ version: 1, pos, lines, dirty })
    },
    rollback() {
      lines = owner._snapshot()
      pos = Math.min(pos, lines.length)
      dirty = false
      return cursor
    },
    flush() {
      owner._flushLines(lines)
      dirty = false
      return cursor
    },
    [Symbol.iterator]() {
      return lines.slice(pos)[Symbol.iterator]()
    }
  }
  return cursor
}

/**
 * PagedText(options) or PagedText(path, options).
 * Synchronous — returns the Proxy directly, no await.
 */
export function PagedText(options, maybeOptions = {}) {
  const opt = typeof options === 'string' ? { ...maybeOptions, path: options } : options
  if (!opt?.path) throw new TypeError('PagedText requires path')

  const file = path.resolve(opt.path)
  const stateFile = path.resolve(opt.state || `${file}.cursor`)
  const kind = kindOf(opt.kind, opt.filling || 'ws')
  const pageSize = opt.pageSize || DEFAULT_PAGE_SIZE
  const layout = opt.layout || 'sequential'

  const store = makeStore(file, kind, pageSize, layout)

  const api = {
    _store: store,
    get length() { return store.totalLines() },
    get text() { return joinLines(store.allLines()) },
    get layout() { return store.layout },

    at(i) { return store.lineAt(i) },
    slice(...a) { return store.allLines().slice(...a) },
    join(sep = '\n') { return store.allLines().join(sep) },
    includes(x) { return store.allLines().includes(x) },
    indexOf(x) { return store.allLines().indexOf(x) },
    lastIndexOf(x) { return store.allLines().lastIndexOf(x) },
    map(fn) { return store.allLines().map(fn) },
    filter(fn) { return store.allLines().filter(fn) },
    find(fn) { return store.allLines().find(fn) },
    findIndex(fn) { return store.allLines().findIndex(fn) },
    some(fn) { return store.allLines().some(fn) },
    every(fn) { return store.allLines().every(fn) },
    forEach(fn) { return store.allLines().forEach(fn) },
    reduce(fn, init) {
      return arguments.length > 1 ? store.allLines().reduce(fn, init) : store.allLines().reduce(fn)
    },
    reduceRight(fn, init) {
      return arguments.length > 1 ? store.allLines().reduceRight(fn, init) : store.allLines().reduceRight(fn)
    },
    entries() { return store.allLines().entries() },
    keys() { return store.allLines().keys() },
    values() { return store.allLines().values() },

    push(...x) {
      const lines = store.allLines()
      const r = lines.push(...x.flat())
      store.replaceAll(lines)
      return r
    },
    pop() {
      const lines = store.allLines()
      const r = lines.pop()
      store.replaceAll(lines)
      return r
    },
    shift() {
      const lines = store.allLines()
      const r = lines.shift()
      store.replaceAll(lines)
      return r
    },
    unshift(...x) {
      const lines = store.allLines()
      const r = lines.unshift(...x.flat())
      store.replaceAll(lines)
      return r
    },
    splice(...x) {
      const lines = store.allLines()
      const r = lines.splice(...x)
      store.replaceAll(lines)
      return r
    },
    reverse() { return store.allLines().slice().reverse() },

    cursor(pos = 0) { return makeCursor(api, pos) },
    loadCursor() {
      const state = JSON.parse(readFileSync(stateFile, 'utf8'))
      return makeCursor(api, state.pos, state.lines)
    },
    _snapshot() { return store.allLines() },
    _saveCursor(state) {
      atomicReplace(stateFile, [Buffer.from(JSON.stringify(state), 'utf8')])
      return api
    },
    _flushLines(lines) {
      store.replaceAll(lines)
      return api
    },
    flush() {
      store.flush()
      return api
    },
    pages() {
      return store.pagesInfo()
    },
    close() { store.close() },

    [Symbol.iterator]() { return store.allLines()[Symbol.iterator]() }
  }

  return new Proxy(api, {
    get(target, prop, receiver) {
      if (indexKey(prop)) return store.lineAt(Number(prop))
      return Reflect.get(target, prop, receiver)
    },
    set(target, prop, value, receiver) {
      if (indexKey(prop)) {
        const lines = store.allLines()
        lines[Number(prop)] = value
        store.replaceAll(lines)
        return true
      }
      return Reflect.set(target, prop, value, receiver)
    },
    deleteProperty(target, prop) {
      if (indexKey(prop)) {
        const lines = store.allLines()
        lines.splice(Number(prop), 1)
        store.replaceAll(lines)
        return true
      }
      return Reflect.deleteProperty(target, prop)
    }
  })
}

export default PagedText
