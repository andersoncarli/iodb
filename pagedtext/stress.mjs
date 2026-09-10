/**
 * stress.mjs — build a big project.listing.md and exercise the whole PagedText
 * API against it. Not part of the test suite; run manually:
 *   bun pagedtext/stress.mjs
 */
import { PagedText } from './pagedtext.js'
import {
  readFileSync, writeFileSync, statSync, existsSync, rmSync
} from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve, join } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const LISTING = join(ROOT, 'project.listing.md')
const PS = 4096
const budgetMs = 15000            // time-bounded, per user rule
const t0 = Date.now()
const tick = label => console.log(`  ${String(Date.now() - t0).padStart(6)}ms  ${label}`)
const bail = () => { if (Date.now() - t0 > budgetMs) { console.error('TIME BUDGET EXCEEDED'); process.exit(1) } }

// ── 1. generate the listing ────────────────────────────────────────────────
const files = execSync('git ls-files', { cwd: ROOT }).toString().trim().split('\n')
  .filter(f => !/\.(png|jpg|jpeg|gif|ico|woff2?|ttf|lock)$/i.test(f))
  .filter(f => !f.startsWith('pagedtext/project.listing') && f !== 'project.listing.md')

let out = ''
let included = 0
for (const f of files) {
  const abs = join(ROOT, f)
  if (!existsSync(abs)) continue
  let body
  try { body = readFileSync(abs, 'utf8') } catch { continue }
  out += `--- ${f}\n${body}`
  if (!body.endsWith('\n')) out += '\n'
  included++
}
// pad it out so the stress is real: repeat the corpus until > 2 MB
const base = out
while (Buffer.byteLength(out) < 2 * 1024 * 1024) out += base
writeFileSync(LISTING, out)
const rawSize = statSync(LISTING).size
const rawLines = out.split('\n').length - 1
tick(`generated listing: ${included} files, ${(rawSize / 1024).toFixed(0)} KB, ${rawLines} lines`)

// ── 2. open as PagedText (migrates legacy plain text on first open) ────────
let t = PagedText({ path: LISTING, kind: 'text' })
tick(`opened + migrated, length=${t.length}`)
bail()

if (t.length !== rawLines) throw new Error(`length mismatch: ${t.length} vs ${rawLines}`)

// ── 3. inspect physical pages ────────────────────────────────────────────
const info = t.pages()
const misaligned = info.filter(p => !p.aligned)
tick(`${info.length} pages, all 4096-aligned=${misaligned.length === 0}`)
if (misaligned.length) throw new Error(`misaligned pages: ${misaligned.map(p => p.index)}`)
const fileSize = statSync(LISTING).size
if (fileSize % PS !== 0) throw new Error(`file size ${fileSize} not a multiple of ${PS}`)
if (fileSize !== PS * (1 + info.length)) throw new Error(`size ${fileSize} != header + ${info.length} pages`)
tick(`file size ${(fileSize / 1024).toFixed(0)} KB = header + ${info.length}×4K`)

// ── 4. random access — point reads must not load every page ─────────────
const fresh = PagedText({ path: LISTING, kind: 'text' })
const mid = Math.floor(fresh.length / 2)
const midLine = fresh.at(mid)
const cachedAfterOnePoint = fresh._store._cache.size
tick(`point read at ${mid}: "${midLine.slice(0, 48)}" — pages cached: ${cachedAfterOnePoint}/${info.length}`)
if (cachedAfterOnePoint > 2) throw new Error(`point read paged in ${cachedAfterOnePoint} pages`)

// spot-check a scattering of indices against a ground-truth split
const truth = out.split('\n'); truth.pop()
for (const i of [0, 1, 7, 100, mid, fresh.length - 2, fresh.length - 1]) {
  if (fresh.at(i) !== truth[i]) throw new Error(`at(${i}) mismatch:\n  got  ${JSON.stringify(fresh.at(i))}\n  want ${JSON.stringify(truth[i])}`)
}
tick('scattered index reads match ground truth')
bail()

// ── 5. slice / iterate / find / indexOf ────────────────────────────────
const firstHeader = t.findIndex(l => l.startsWith('--- '))
const someSlice = t.slice(firstHeader, firstHeader + 3)
tick(`findIndex '--- ' => ${firstHeader}; slice: ${JSON.stringify(someSlice[0].slice(0, 40))}`)
let count = 0
for (const line of t) { if (line.startsWith('--- ')) count++ }
tick(`iterated all ${t.length} lines, ${count} section headers`)
if (t.indexOf(truth[500]) === -1 && truth[500] !== '') throw new Error('indexOf failed for a known line')

// ── 6. cursor: save (no source change) then flush (atomic) ─────────────
const before = readFileSync(LISTING)
const c = t.cursor(mid)
c.insert('>>> STRESS INSERT A', '>>> STRESS INSERT B')
if (c.pos !== mid + 2) throw new Error(`cursor pos after insert ${c.pos} != ${mid + 2}`)
c.seek(0).write('>>> FIRST LINE REWRITTEN')
if (c.pos !== 1) throw new Error(`cursor pos after seek(0).write ${c.pos} != 1`)
c.save()
if (Buffer.compare(readFileSync(LISTING), before) !== 0) throw new Error('cursor.save() modified the source')
tick('cursor.save(): source untouched, sidecar written')

const reloaded = t.loadCursor()
if (reloaded.pos !== 1) throw new Error(`loadCursor pos ${reloaded.pos} != 1`)
tick(`loadCursor(): pos=${reloaded.pos}, length=${reloaded.length}`)

c.flush()
bail()
const after = PagedText({ path: LISTING, kind: 'text' })
if (after.at(0) !== '>>> FIRST LINE REWRITTEN') throw new Error('flush did not persist line 0 rewrite')
if (after.at(mid) !== '>>> STRESS INSERT A') throw new Error(`flush did not persist insert (at ${mid} = ${JSON.stringify(after.at(mid))})`)
if (after.at(mid + 1) !== '>>> STRESS INSERT B') throw new Error('flush did not persist second insert')
if (after.length !== rawLines + 2) throw new Error(`length after insert ${after.length} != ${rawLines + 2}`)
const infoAfter = after.pages()
if (infoAfter.some(p => !p.aligned)) throw new Error('pages misaligned after flush')
tick(`flush persisted: length=${after.length}, ${infoAfter.length} pages, still aligned`)

// ── 7. mutating array ops through the proxy (each op re-materialises) ──
const m = PagedText({ path: LISTING, kind: 'text' })
const lenBefore = m.length
m.push('>>> APPENDED VIA push()')            // +1 at end
m.splice(10, 0, '>>> SPLICED AT 10')          // +1 at index 10
m[5] = '>>> ASSIGNED AT 5'                     // replace index 5
delete m[6]                                    // -1 at index 6 (shifts 10 -> 9)
const lenAfter = m.length
tick(`push+splice+assign+delete: ${lenBefore} -> ${lenAfter}`)
if (lenAfter !== lenBefore + 1) throw new Error(`net length ${lenAfter} != ${lenBefore + 1}`)
const rt = PagedText({ path: LISTING, kind: 'text' })
if (rt.length !== lenAfter) throw new Error(`reopen length ${rt.length} != ${lenAfter}`)
if (rt.at(5) !== '>>> ASSIGNED AT 5') throw new Error('assign did not round-trip')
if (rt.at(9) !== '>>> SPLICED AT 10') throw new Error(`splice did not round-trip (at 9 = ${JSON.stringify(rt.at(9))})`)
if (rt.at(-1) !== '>>> APPENDED VIA push()') throw new Error('push did not round-trip')
tick('all mutations round-tripped through reopen')

// ── 8. filling survives a trailing-whitespace-trimming editor ─────────
const trimmed = readFileSync(LISTING, 'utf8').split('\n').map(l => l.replace(/ +$/, '')).join('\n')
writeFileSync(LISTING, trimmed)
const survivor = PagedText({ path: LISTING, kind: 'text' })
if (survivor.length !== rt.length) throw new Error(`length after trim ${survivor.length} != ${rt.length}`)
if (survivor.at(0) !== rt.at(0)) throw new Error('line 0 changed after trim')
tick(`survived 'sed s/ *$//': length=${survivor.length} intact`)

// ── 9. throughput: repeated point reads ─────────────────────────────
const N = 5000
const rd = PagedText({ path: LISTING, kind: 'text' })
const rs = Date.now()
let acc = 0
let seed = 12345
for (let i = 0; i < N; i++) {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  const idx = seed % rd.length
  const line = rd.at(idx)
  acc += line == null ? 0 : line.length
}
const rms = Date.now() - rs
tick(`${N} random point reads in ${rms}ms (${(rms / N * 1000).toFixed(1)}µs/read), cache=${rd._store._cache.size} pages`)
bail()

// ── 10. cleanup ────────────────────────────────────────────────────
rmSync(LISTING, { force: true })
rmSync(LISTING + '.cursor', { force: true })
tick('cleanup done')
console.log(`\n✓ PagedText stress passed in ${Date.now() - t0}ms (budget ${budgetMs}ms)`)
