import fs from 'node:fs/promises'
import path from 'node:path'

const indexOf = p => typeof p === 'string' && /^(0|[1-9]\d*)$/.test(p)

const builtinKinds = {
  clike: {
    fillMode: 'ws',
    fill: () => ' \n',
    commentFill: () => '//- pagedtext filling\n',
    isFill: line => line.trimStart().startsWith('//- pagedtext filling') || line === ' '
  },
  text: {
    fillMode: 'ws',
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
    return {
      ...k,
      fillMode: filling,
      fill: filling === 'comment' ? k.commentFill : k.fill
    }
  }
  return kind
}

function splitLines(text, kind) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.filter(line => !kind.isFill(line))
}

function joinLines(lines) {
  return lines.length ? lines.join('\n') + '\n' : ''
}

function packPages(lines, pageSize) {
  const pages = []
  let page = []
  let bytes = 0

  for (const line of lines) {
    const n = Buffer.byteLength(line + '\n')
    if (page.length && bytes + n > pageSize) {
      pages.push(page)
      page = []
      bytes = 0
    }
    page.push(line)
    bytes += n
  }
  if (page.length) pages.push(page)
  return pages
}

function renderPages(pages, kind) {
  return pages.map((page, i) => {
    let out = joinLines(page)
    if (i < pages.length - 1) out += kind.fill()
    return out
  }).join('')
}

async function atomicWrite(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const fh = await fs.open(tmp, 'w')
  try {
    await fh.writeFile(data, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  await fs.rename(tmp, file)
}

function makeCursor(owner, start = 0, initial = null) {
  let lines = initial ? initial.slice() : owner._lines.slice()
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
      lines = owner._lines.slice()
      pos = Math.min(pos, lines.length)
      dirty = false
      return cursor
    },
    async flush() {
      await owner._flushLines(lines)
      owner._lines = lines.slice()
      dirty = false
      return cursor
    },

    [Symbol.iterator]() {
      return lines.slice(pos)[Symbol.iterator]()
    }
  }
  return cursor
}

export async function PagedText(options, maybeOptions = {}) {
  const opt = typeof options === 'string' ? { ...maybeOptions, path: options } : options
  if (!opt?.path) throw new TypeError('PagedText requires path')

  const file = path.resolve(opt.path)
  const stateFile = path.resolve(opt.state || `${file}.cursor`)
  const kind = kindOf(opt.kind, opt.filling || 'ws')
  const pageSize = opt.pageSize || 64 * 1024

  await fs.mkdir(path.dirname(file), { recursive: true })
  try { await fs.access(file) } catch { await fs.writeFile(file, '') }

  const raw = await fs.readFile(file, 'utf8')
  const api = {
    _lines: splitLines(raw, kind),

    get length() { return api._lines.length },
    get text() { return joinLines(api._lines) },

    at(i) { return api._lines.at(i) },
    slice(...a) { return api._lines.slice(...a) },
    join(sep = '\n') { return api._lines.join(sep) },
    includes(x) { return api._lines.includes(x) },
    indexOf(x) { return api._lines.indexOf(x) },
    lastIndexOf(x) { return api._lines.lastIndexOf(x) },
    map(fn) { return api._lines.map(fn) },
    filter(fn) { return api._lines.filter(fn) },
    find(fn) { return api._lines.find(fn) },
    findIndex(fn) { return api._lines.findIndex(fn) },
    some(fn) { return api._lines.some(fn) },
    every(fn) { return api._lines.every(fn) },
    forEach(fn) { return api._lines.forEach(fn) },
    reduce(fn, init) { return arguments.length > 1 ? api._lines.reduce(fn, init) : api._lines.reduce(fn) },
    reduceRight(fn, init) { return arguments.length > 1 ? api._lines.reduceRight(fn, init) : api._lines.reduceRight(fn) },
    entries() { return api._lines.entries() },
    keys() { return api._lines.keys() },
    values() { return api._lines.values() },

    push(...x) { return api._lines.push(...x.flat()) },
    pop() { return api._lines.pop() },
    shift() { return api._lines.shift() },
    unshift(...x) { return api._lines.unshift(...x.flat()) },
    splice(...x) { return api._lines.splice(...x) },
    reverse() { return api._lines.slice().reverse() },

    cursor(pos = 0) { return makeCursor(api, pos) },
    async loadCursor() {
      const state = JSON.parse(await fs.readFile(stateFile, 'utf8'))
      return makeCursor(api, state.pos, state.lines)
    },
    async _saveCursor(state) {
      await atomicWrite(stateFile, JSON.stringify(state))
      return api
    },
    async _flushLines(lines) {
      const pages = packPages(lines, pageSize)
      await atomicWrite(file, renderPages(pages, kind))
    },
    async flush() {
      await api._flushLines(api._lines)
      return api
    },
    async pages() {
      return packPages(api._lines, pageSize).map((lines, index) => ({
        index,
        lines: lines.length,
        bytes: Buffer.byteLength(joinLines(lines))
      }))
    },

    [Symbol.iterator]() { return api._lines[Symbol.iterator]() }
  }

  return new Proxy(api, {
    get(target, prop, receiver) {
      if (indexOf(prop)) return target._lines[Number(prop)]
      return Reflect.get(target, prop, receiver)
    },
    set(target, prop, value, receiver) {
      if (indexOf(prop)) {
        target._lines[Number(prop)] = value
        return true
      }
      return Reflect.set(target, prop, value, receiver)
    },
    deleteProperty(target, prop) {
      if (indexOf(prop)) {
        target._lines.splice(Number(prop), 1)
        return true
      }
      return Reflect.deleteProperty(target, prop)
    }
  })
}
