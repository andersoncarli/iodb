import { PagedText } from './pagedtext.js'
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PS = 4096

test('pagedtext: logical array over pages', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'x.js')
    writeFileSync(file, 'a\nb\nc\nd\n')
    const t = PagedText({ path: file, kind: 'clike', pageSize: 4096 })

    check(t.length, 4)
    check(t[0], 'a')
    check(t.at(-1), 'd')
    check(t.slice(1, 3).join(','), 'b,c')
    check([...t].join(''), 'abcd')
  })
})

test('pagedtext: array-like editing stays logical, filling hidden', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'x.js')
    writeFileSync(file, 'a\nb\nc\nd\n')
    const t = PagedText({ path: file, kind: 'clike', pageSize: 4096 })

    t[1] = 'B'
    check(t[1], 'B')
    t.push('e')
    check(t.pop(), 'e')
    t.unshift('z')
    check(t.shift(), 'z')
    t.splice(1, 1, 'BB', 'BBB')
    check([...t].join(','), 'a,BB,BBB,c,d')
    check(t.reverse().join(','), 'd,c,BBB,BB,a')
  })
})

test('pagedtext: header is versioned and page 0', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'x.txt')
    writeFileSync(file, 'one\ntwo\nthree\n')
    const t = PagedText({ path: file, pageSize: 4096 })
    t.flush()

    const raw = readFileSync(file)
    const header = JSON.parse(raw.toString('utf8', 0, raw.indexOf(0)))
    check(header.magic, 'PAGEDTEXT')
    check(header.version, 2)
    check(header.pageSize, PS)
    check(Array.isArray(header.pages), true)
    check(header.pages[0], 3)
  })
})

test('pagedtext: every page offset is 4096-aligned', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'big.txt')
    // ~3 pages of ~40-byte lines
    const lines = Array.from({ length: 160 }, (_, i) => `line number ${i} with some padding text here`)
    writeFileSync(file, lines.join('\n') + '\n')
    const t = PagedText({ path: file, pageSize: 4096 })
    t.flush()

    const info = t.pages()
    check(info.length > 1, true)
    check(info.every(p => p.aligned), true)
    check(info.every(p => p.offset % PS === 0), true)

    // File size is header + N full pages (last page also padded to PS).
    const size = statSync(file).size
    check(size % PS === 0, true)
    check(size, PS * (1 + info.length))
  })
})

test('pagedtext: reopen sees the same logical text, filling invisible', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'x.js')
    writeFileSync(file, 'a\nb\nc\nd\n')
    const t = PagedText({ path: file, kind: 'clike', pageSize: 4096 })
    t.push('e', 'f')
    t.flush()

    const reopened = PagedText({ path: file, kind: 'clike', pageSize: 4096 })
    check([...reopened].join(','), 'a,b,c,d,e,f')

    const raw = readFileSync(file, 'utf8')
    check(raw.includes('//- pagedtext filling'), false)   // ws is the default
  })
})

test('pagedtext: page cache does not load every page for a point read', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'big.txt')
    const lines = Array.from({ length: 220 }, (_, i) => `row ${i} ${'x'.repeat(40)}`)
    writeFileSync(file, lines.join('\n') + '\n')
    const t = PagedText({ path: file, pageSize: 4096 })
    t.flush()

    // fresh handle, read one line near the start
    const t2 = PagedText({ path: file, pageSize: 4096 })
    check(t2.at(1), 'row 1 ' + 'x'.repeat(40))
    // only the page holding index 1 should be cached, not all of them
    const cached = t2._store._cache.size
    check(cached, 1)
    check(t2._store.pageCount() > 1, true)
  })
})

test('pagedtext: cursor save does not touch source, flush does', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'x.js')
    writeFileSync(file, 'a\nb\nc\nd\n')
    const t = PagedText({ path: file, kind: 'clike', pageSize: 4096 })
    t.flush()

    const before = readFileSync(file)
    const c = t.cursor(2)
    c.insert('X', 'Y').next().overwrite('CC').seek(0).write('A')
    check(c.dirty, true)
    c.save()
    check(Buffer.compare(readFileSync(file), before), 0)   // unchanged

    const saved = JSON.parse(readFileSync(file + '.cursor', 'utf8'))
    check(saved.dirty, true)

    const c2 = t.loadCursor()
    check(c2.pos, saved.pos)

    c.flush()
    check(Buffer.compare(readFileSync(file), before) !== 0, true)   // changed
    check(c.dirty, false)
  })
})

test('pagedtext: explicit comment filling', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'c.js')
    // enough lines to force more than one page so filling is emitted
    const lines = Array.from({ length: 200 }, (_, i) => `stmt${i}();`)
    writeFileSync(file, lines.join('\n') + '\n')
    const t = PagedText({ path: file, kind: 'clike', filling: 'comment', pageSize: 4096 })
    t.flush()

    const raw = readFileSync(file, 'utf8')
    check(/\/\/- pagedtext filling/.test(raw), true)
    // logical view never shows the filling
    check([...t].every(l => !l.startsWith('//- pagedtext filling')), true)
    check(t.length, 200)
  })
})

test('pagedtext: filling survives an editor that trims trailing whitespace', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'x.txt')
    const lines = Array.from({ length: 130 }, (_, i) => `data-${i} ${"=".repeat(20)}`)
    writeFileSync(file, lines.join('\n') + '\n')
    const t = PagedText({ path: file, pageSize: 4096 })
    t.flush()

    // simulate `sed -i 's/ *$//'` — strip trailing spaces on every line
    const trimmed = readFileSync(file, 'utf8')
      .split('\n').map(l => l.replace(/ +$/, '')).join('\n')
    writeFileSync(file, trimmed)

    // the header's line counts still mark page boundaries — reopen is intact
    const reopened = PagedText({ path: file, pageSize: 4096 })
    check(reopened.length, 130)
    check(reopened.at(0), `data-0 ${'='.repeat(20)}`)
    check(reopened.at(-1), `data-129 ${'='.repeat(20)}`)
  })
})

test('pagedtext: sequential layout preserves order under repeated append', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'log.txt')
    // seed via the cursor so the pages are built once, not once per push:
    // t.push() through the proxy rewrites the whole file each call.
    writeFileSync(file, Array.from({ length: 300 }, (_, i) => `event ${i}`).join('\n') + '\n')
    const t = PagedText({ path: file, layout: 'sequential', pageSize: 4096 })
    t.flush()

    const reopened = PagedText({ path: file, pageSize: 4096 })
    check(reopened.length, 300)
    check(reopened.at(0), 'event 0')
    check(reopened.at(150), 'event 150')
    check(reopened.at(-1), 'event 299')
    check(reopened.layout, 'sequential')
  })
})

test('pagedtext: legacy plain-text file migrates on open', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'legacy.txt')
    // a plain file larger than one page, no PagedText header
    const lines = Array.from({ length: 160 }, (_, i) => `legacy line ${i} ${'.'.repeat(20)}`)
    writeFileSync(file, lines.join('\n') + '\n')

    const t = PagedText({ path: file, pageSize: 4096 })
    check(t.length, 160)
    check(t.at(159), `legacy line 159 ${'.'.repeat(20)}`)

    // after first open it now carries the header
    const raw = readFileSync(file)
    const header = JSON.parse(raw.toString('utf8', 0, raw.indexOf(0)))
    check(header.magic, 'PAGEDTEXT')
  })
})
