/**
 * hello-paged.js — the basics of a PagedText file, with deliberately small
 * pages so the pagination is visible.
 *
 * Run it:  bun pagedtext/hello-paged.js
 *
 * PagedText treats a text file as a logical array of lines while physically
 * storing it in fixed-size pages. The page size here is 128 bytes — tiny, so a
 * handful of short lines already spills across several pages. In real use it is
 * 4096 or 64K and the same code applies unchanged.
 */

import { PagedText } from './pagedtext.js'
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'hello-paged-'))
const file = join(dir, 'notes.txt')
const PAGE = 128
const show = (label, v) => console.log(`  ${label.padEnd(34)} ${v}`)

try {
  // ── 1. open a plain text file as PagedText ───────────────────────────────
  // Eighteen lines of ordinary text. Nothing about the file is special yet.
  const seed = [
    'the quick brown fox', 'jumps over the lazy dog', 'pack my box with',
    'five dozen liquor jugs', 'how vexingly quick', 'daft zebras jump',
    'the five boxing wizards', 'jump quickly at dawn', 'sphinx of black quartz',
    'judge my vow', 'two driven jocks', 'help fax my big quiz',
    'crazy Fredrick bought', 'many very exquisite', 'opal jewels',
    'we promptly judged', 'antique ivory buckles', 'for the next prize',
  ]
  writeFileSync(file, seed.join('\n') + '\n')

  const t = PagedText({ path: file, kind: 'text', pageSize: PAGE })
  console.log('\n1. opened as a logical array of lines')
  show('t.length', t.length)
  show('t[0]', JSON.stringify(t[0]))
  show('t.at(-1)', JSON.stringify(t.at(-1)))
  show('t.slice(1, 3)', JSON.stringify(t.slice(1, 3)))
  show('t.slice(0, 4)', JSON.stringify(t.slice(0, 4)))

  // ── 2. it is physically split into pages ────────────────────────────────
  // The first open migrated the plain file: it now carries a versioned header
  // in page 0 and the content lives in 128-byte data pages after it.
  t.flush()
  const pages = t.pages()
  console.log(`\n2. physically stored in ${pages.length} pages of ${PAGE} bytes`)
  for (const p of pages) {
    show(`page ${p.index}`, `${p.lines} lines, ${p.bytes} content bytes, offset ${p.offset} (aligned: ${p.aligned})`)
  }
  const buf = readFileSync(file)
  const header = JSON.parse(buf.toString('utf8', 0, buf.indexOf(0)))
  show('header (page 0)', JSON.stringify(header))
  // a point read touches ONE page, not the whole file
  const probe = PagedText({ path: file, kind: 'text', pageSize: PAGE })
  probe.at(t.length - 2)
  show('pages loaded to read line ' + (t.length - 2), probe._store._cache.size + ' of ' + pages.length)

  // ── 3. editing stays logical — pages are an implementation detail ──────
  console.log('\n3. array-like editing, pagination stays hidden')
  t[1] = 'JUMPS OVER'
  t.push('the end')
  show("t[1]='JUMPS OVER'; t.push('the end')", `length ${t.length}, t[1]=${JSON.stringify(t[1])}, t.at(-1)=${JSON.stringify(t.at(-1))}`)
  t.splice(2, 1, 'a', 'b')
  show('t.splice(2, 1, "a", "b")', `length ${t.length}, t.slice(1, 5)=${JSON.stringify(t.slice(1, 5))}`)
  show('re-paginated to', t.pages().map(p => p.lines).join(' + ') + ' lines/page')

  // ── 4. the cursor is a change buffer — save() does not touch the file ──
  console.log('\n4. cursor: a change buffer over the logical text')
  const before = readFileSync(file)
  const c = t.cursor(0)
  c.write('FIRST').next().insert('second-ish')
  show('c.dirty', c.dirty)
  c.save()
  show('source file changed by save()?', Buffer.compare(readFileSync(file), before) !== 0)
  const sidecar = JSON.parse(readFileSync(file + '.cursor', 'utf8'))
  show('sidecar .cursor holds', `pos=${sidecar.pos}, ${sidecar.lines.length} lines, dirty=${sidecar.dirty}`)

  // loadCursor() picks the pending change back up
  const reloaded = t.loadCursor()
  show('t.loadCursor().pos', reloaded.pos)

  // ── 5. flush() is the physical write boundary, and it is atomic ────────
  console.log('\n5. flush() publishes the change (temp + fsync + rename)')
  c.flush()
  show('source file changed by flush()?', Buffer.compare(readFileSync(file), before) !== 0)
  show('c.dirty after flush', c.dirty)

  const t2 = PagedText({ path: file, kind: 'text', pageSize: PAGE })
  show('reopened, first line', JSON.stringify(t2.at(0)))
  show('reopened, length', t2.length)

  // ── 6. filling is padding, not content — invisible to the reader ──────
  // The default filling is whitespace. It fills each page out to 128 bytes so
  // the next page starts on a boundary, and it never appears in the logical
  // view. An explicit 'comment' mode makes it visible for debugging.
  console.log('\n6. filling: physical padding, semantically invisible')
  const raw = readFileSync(file, 'utf8')
  show('file has trailing spaces (ws filling)', / \n| $/.test(raw))
  show('logical view shows any filling?', [...t2].some(l => l.trim() === '' || l.startsWith('#-')))

  const cfile = join(dir, 'code.txt')
  writeFileSync(cfile, Array.from({ length: 12 }, (_, i) => `statement ${i};`).join('\n') + '\n')
  const commented = PagedText({ path: cfile, kind: 'text', filling: 'comment', pageSize: PAGE })
  commented.flush()
  show("comment filling visible in file", /#- pagedtext filling/.test(readFileSync(cfile, 'utf8')))
  show('but not in the logical view', commented.filter(l => l.startsWith('#- ')).length === 0)

  // ── 7. the page boundary survives an editor that trims whitespace ─────
  // The header's per-page line count is the authority on where a page ends,
  // not the run of spaces. Strip every trailing space and the file still opens.
  console.log('\n7. page boundaries survive `sed -i "s/ *$//"`')
  const trimmed = readFileSync(file, 'utf8').split('\n').map(l => l.replace(/ +$/, '')).join('\n')
  writeFileSync(file, trimmed)
  const survivor = PagedText({ path: file, kind: 'text', pageSize: PAGE })
  show('reopened length after trim', survivor.length)
  show('reopened first line after trim', JSON.stringify(survivor.at(0)))

  console.log('\n✓ hello-paged: the basics work with small pages')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
