// Probe da feature 8.3 — o cursor preguicoso sobre paginas do PagedText.
import { PagedText } from '../../pagedtext/pagedtext.js'
import { pageCursor } from '../../src/table/page-cursor.js'
import { limitCursor, toArray } from '../../src/table/cursor.js'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'iodb-83-probe-'))
const file = join(dir, 'big.txt')
const pt = PagedText(file, { pageSize: 128, layout: 'sequential' })
const N = 5000
const lines = []
for (let i = 0; i < N; i++) lines.push('line-' + i)
pt._store.replaceAll(lines)
pt._store.flush()
const store = pt._store

console.log('pageCount:', store.pageCount())

// limit(10) le O(1) paginas.
const c1 = pageCursor(store)
const first10 = toArray(limitCursor(c1, 10))
console.log('first10-len:', first10.length)
console.log('limit10-pagesRead:', c1.pagesRead)
console.log('limit10-is-O1:', c1.pagesRead <= 5)

// Reentrancia: dois cursores intercalados.
const a = pageCursor(store)
const b = pageCursor(store)
const interleaved = [a.next(), b.next(), a.next(), b.next()]
console.log('interleaved:', interleaved.join('|'))

// pagesRead monotonico e livePages maximo 1 num scan completo.
const c2 = pageCursor(store)
let prevPages = 0, monotonic = true, maxLive = 0
let v
while ((v = c2.next()) !== null) {
  if (c2.pagesRead < prevPages) monotonic = false
  prevPages = c2.pagesRead
  maxLive = Math.max(maxLive, c2.livePages)
}
console.log('monotonic:', monotonic)
console.log('maxLive:', maxLive)
console.log('finalPagesRead:', c2.pagesRead)
console.log('storePageCount:', store.pageCount())

// close() esgota sem lancar.
const c3 = pageCursor(store)
c3.next()
c3.close()
console.log('after-close:', c3.next())

rmSync(dir, { recursive: true, force: true })
