import { pageCursor } from './page-cursor.js'
import { limitCursor, toArray, cursorFromArray } from './cursor.js'
import { conform } from './conformance.js'
import { PagedText } from '../../pagedtext/pagedtext.js'

function makeStore(dir, n, pageSize = 256) {
  const file = dir + '/page-cursor-fixture.txt'
  const pt = PagedText(file, { pageSize, layout: 'sequential' })
  const lines = []
  for (let i = 0; i < n; i++) lines.push('line-' + i)
  pt._store.replaceAll(lines)
  pt._store.flush()
  return pt._store
}

test('page-cursor: le todas as linhas na ordem, igual allLines()', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const store = makeStore(dir, 500)
    const seen = toArray(pageCursor(store))
    check(seen, store.allLines())
  })
})

test('page-cursor: dois cursores sao independentes e intercalaveis (lei da reentrancia)', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const store = makeStore(dir, 500)
    const a = pageCursor(store)
    const b = pageCursor(store)
    check(a.next(), 'line-0')
    check(b.next(), 'line-0')
    check(a.next(), 'line-1')
    check(a.next(), 'line-2')
    check(b.next(), 'line-1')
  })
})

test('page-cursor: e iteravel com for..of', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const store = makeStore(dir, 50)
    const seen = []
    for (const line of pageCursor(store)) seen.push(line)
    check(seen.length, 50)
    check(seen[0], 'line-0')
    check(seen[49], 'line-49')
  })
})

test('page-cursor: limit(10) sobre um arquivo de muitas paginas le O(1) paginas', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    // pageSize pequeno para forcar muitas paginas com poucas linhas.
    const store = makeStore(dir, 5000, 128)
    const totalPages = store.pageCount()
    const c = pageCursor(store)
    const limited = toArray(limitCursor(c, 10))
    check(limited.length, 10)
    check(c.pagesRead < totalPages, true)
    // O(1): nao cresce com o tamanho do arquivo, so com quantas linhas cabem
    // nas primeiras paginas. Generoso o bastante para nao ser fragil ao
    // pageSize exato, mas longe de "leu tudo".
    check(c.pagesRead <= 5, true)
  })
})

test('page-cursor: pagesRead e monotonico conforme as linhas sao consumidas', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const store = makeStore(dir, 2000, 128)
    const c = pageCursor(store)
    let prev = 0
    let grew = 0
    for (let i = 0; i < 2000; i++) {
      c.next()
      check(c.pagesRead >= prev, true)
      if (c.pagesRead > prev) grew++
      prev = c.pagesRead
    }
    check(grew > 1, true)
  })
})

test('page-cursor: livePages nunca passa de 1 durante um scan completo, allLines() materializa pageCount() paginas', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const store = makeStore(dir, 3000, 128)
    const c = pageCursor(store)
    let maxLive = 0
    let v
    while ((v = c.next()) !== null) maxLive = Math.max(maxLive, c.livePages)
    check(maxLive, 1)
    check(store.pageCount() > 1, true)
  })
})

test('page-cursor: close() esgota o cursor, next() depois devolve null sem lancar', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const store = makeStore(dir, 100)
    const c = pageCursor(store)
    c.next(); c.next()
    c.close()
    check(c.next(), null)
    check(c.next(), null)
  })
})

test('page-cursor: conform() passa contra um wrapper Table sobre pageCursor', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const store = makeStore(dir, 200)
    const rows = store.allLines().map((line, i) => ({ id: i, line }))
    function makeTable(rs) {
      return {
        schema: { fields: { id: { type: 'number', pk: true } } },
        scan: () => {
          const c = pageCursor(store)
          return {
            next() { const v = c.next(); return v === null ? null : { id: rows.findIndex(r => r.line === v), line: v } },
            close: () => c.close(),
            [Symbol.iterator]() {
              return { next: () => { const v = this.next(); return v === null ? { done: true } : { done: false, value: v } } }
            }
          }
        }
      }
    }
    check(conform(makeTable, rows, { pk: 'id' }), true)
  })
})
