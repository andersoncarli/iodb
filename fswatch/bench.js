#!/usr/bin/env bun
/**
 * fswatch/bench.js — a standing tool, not a test, and not a benchmark.
 *
 * A comparative USE: the two engines run side by side on the same input and the
 * tool records what each took. No warmup, no repeats, no averaging. The numbers
 * are the log of one real reconstruction, not a claim about steady-state
 * performance — build time and path-lookup in particular swing run to run with
 * disk-cache state.
 *
 * The comparative reconstruction of the four listed repositories. For each one:
 *
 *   1. SCAN the whole tree ONCE — this is the same for both formats, so it is
 *      timed once and reported on its own. It tells you what is in the repo.
 *   2. BUILD the corpus twice from that one scan — into iodb (paged text) and
 *      into the sqlite baseline. Two construction numbers, one input.
 *   3. LOOKUPS inside each built corpus — by key (dev:ino) and by path.
 *   4. SEARCHES inside each — predicate scans (all .js, all dirs).
 *
 *   bun fswatch/bench.js
 *
 * Scanning is held apart from record storage: phase 1 is one shared traversal;
 * phases 2-4 are what the two formats are compared on. Stores go under
 * os.tmpdir(); no real project's .fswatch/ is touched. A repo that does not
 * exist is skipped.
 */
import { describe, MetadataStore, SqliteStore } from './fswatch.js'
import { mkdtemp, rm, stat, readdir } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'

const HOME = homedir()
const expand = p => path.resolve(String(p).replace(/^~(?=$|\/)/, HOME))

// One scan of the whole tree, carrying `path` so lookup-by-path is a real
// measurement. This IS the same scan for both formats — the resulting Map feeds
// both stores unchanged. It uses fswatch.js's own `describe` per entry; the
// walk is a plain recursion because Scanner does not thread the path through.
const scanTree = async root => {
  const found = new Map()
  const walk = async (dir, parentId) => {
    let list
    try { list = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const d of list) {
      const full = path.join(dir, d.name)
      let e
      try { e = await describe(full, parentId) } catch { continue }
      e.path = full
      found.set(e.id, e)
      if (e.kind === 'dir') await walk(full, e.id)
    }
  }
  let e
  try { e = await describe(root) } catch { return found }
  e.path = root
  found.set(e.id, e)
  if (e.kind === 'dir') await walk(root, e.id)
  return found
}

const REPOS = ['~/iodb', '~/utest', '~/sprint-cli', '~/soml']
const SAMPLE = 200        // ids / paths drawn for the lookup phase

const ms = t0 => Number((performance.now() - t0).toFixed(1))
const kb = b => (b / 1024).toFixed(1) + 'K'

const dirSizeOf = async base => {
  const dir = path.dirname(base)
  const stem = path.basename(base)
  let total = 0, names = []
  try { names = await readdir(dir) } catch { return 0 }
  for (const n of names) {
    if (!n.startsWith(stem)) continue
    try { total += (await stat(path.join(dir, n))).size } catch {}
  }
  return total
}

// Build a corpus by writing every scanned entry into `store`.
//
// iodb: buffered puts, one flush at the end — exactly Scanner.scan's shape in
// fswatch.js. sqlite: the same entries inside ONE transaction. Wrapping the
// bulk load in a transaction is what any real sqlite consumer does; without it
// bun:sqlite fsyncs per row and the "baseline" would be a strawman. The bench
// reaches the transaction through the exposed .db handle; SqliteStore itself is
// unchanged.
const build = (store, entries) => {
  const tx = store.db && typeof store.db.exec === 'function'
  const t0 = performance.now()
  if (tx) store.db.exec('BEGIN')
  for (const e of entries) store.put(e, { flush: false })
  if (tx) store.db.exec('COMMIT')
  store.flush()
  return ms(t0)
}

const sampleFrom = (arr, n) => {
  if (arr.length <= n) return arr.slice()
  const out = []
  const step = arr.length / n
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)])
  return out
}

// Lookups and searches against an already-built corpus, expressed as plain
// functions over the store's public surface so iodb and sqlite run the same
// calls where they can.
const probeCorpus = (label, store, ids, paths) => {
  const rows = store.all()
  const byId = new Map(rows.map(r => [r.id, r]))

  let t0 = performance.now()
  let hitId = 0
  for (const id of ids) if (byId.get(id)) hitId++
  const lookupKeyMs = ms(t0)

  t0 = performance.now()
  let hitPath = 0
  for (const p of paths) if (rows.find(r => r.path === p)) hitPath++
  const lookupPathMs = ms(t0)

  t0 = performance.now()
  const js = rows.filter(r => r.name && r.name.endsWith('.js')).length
  const searchJsMs = ms(t0)

  t0 = performance.now()
  const dirs = rows.filter(r => r.kind === 'dir').length
  const searchDirMs = ms(t0)

  return {
    label, rows: rows.length,
    lookupKeyMs, hitId, lookupPathMs, hitPath,
    searchJsMs, js, searchDirMs, dirs,
  }
}

const benchRepo = async spec => {
  const target = expand(spec)
  const label = path.basename(target)
  try {
    if (!(await stat(target)).isDirectory()) throw 0
  } catch {
    console.log(`\n  ${label} — pulado (nao existe: ${spec})`)
    return null
  }

  const work = await mkdtemp(path.join(tmpdir(), `fswbench-${label}-`))
  try {
    // ── Phase 1: one scan, shared by both formats. ─────────────────────
    const t0 = performance.now()
    const found = await scanTree(target)
    const scanMs = ms(t0)
    const entries = [...found.values()]

    const ids = sampleFrom(entries.map(e => e.id), SAMPLE)
    const paths = sampleFrom(entries.map(e => e.path).filter(Boolean), SAMPLE)

    // ── Phase 2: build the corpus twice from that one scan. ─────────────
    const iodbBase = path.join(work, 'iodb')
    const iodbStore = MetadataStore(iodbBase)
    const iodbBuildMs = build(iodbStore, entries)

    const sqBase = path.join(work, 'sqlite')
    const sqStore = SqliteStore(sqBase)
    const sqBuildMs = build(sqStore, entries)

    const iodbBytes = await dirSizeOf(iodbBase)
    const sqBytes = await dirSizeOf(sqBase)

    // ── Phases 3-4: lookups and searches inside each. ──────────────────
    const iodbProbe = probeCorpus('iodb', iodbStore, ids, paths)
    const sqProbe = probeCorpus('sqlite', sqStore, ids, paths)

    iodbStore.close()
    sqStore.close()

    const row = {
      label, entries: found.size, scanMs,
      iodbBuildMs, sqBuildMs, iodbBytes, sqBytes,
      iodbProbe, sqProbe,
    }
    printRepo(row)
    return row
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

const printRepo = r => {
  console.log(`\n  ${r.label}  —  ${r.entries} entries`)
  console.log(`    scan (arvore inteira, 1x, comum aos dois)   ${String(r.scanMs).padStart(9)} ms`)
  console.log(`    ${''.padEnd(44)}   ${'iodb'.padStart(12)}   ${'sqlite'.padStart(12)}`)
  console.log(`    construcao do corpus                        ${String(r.iodbBuildMs + ' ms').padStart(12)}   ${String(r.sqBuildMs + ' ms').padStart(12)}`)
  console.log(`    corpus em disco                             ${kb(r.iodbBytes).padStart(12)}   ${kb(r.sqBytes).padStart(12)}`)
  console.log(`    lookup por chave (${String(r.iodbProbe.hitId).padStart(3)} de ${SAMPLE})               ${String(r.iodbProbe.lookupKeyMs + ' ms').padStart(12)}   ${String(r.sqProbe.lookupKeyMs + ' ms').padStart(12)}`)
  console.log(`    lookup por path  (${String(r.iodbProbe.hitPath).padStart(3)} de ${SAMPLE})               ${String(r.iodbProbe.lookupPathMs + ' ms').padStart(12)}   ${String(r.sqProbe.lookupPathMs + ' ms').padStart(12)}`)
  console.log(`    busca  name ~ .js  (${String(r.iodbProbe.js).padStart(4)})                    ${String(r.iodbProbe.searchJsMs + ' ms').padStart(12)}   ${String(r.sqProbe.searchJsMs + ' ms').padStart(12)}`)
  console.log(`    busca  kind = dir  (${String(r.iodbProbe.dirs).padStart(4)})                    ${String(r.iodbProbe.searchDirMs + ' ms').padStart(12)}   ${String(r.sqProbe.searchDirMs + ' ms').padStart(12)}`)
}

const main = async () => {
  console.log('fswatch/bench.js — reconstrucao comparativa · iodb paged text vs baseline sqlite')
  console.log('(scan da arvore inteira, uma vez, comum aos dois formatos)')
  const rows = []
  for (const spec of REPOS) {
    const row = await benchRepo(spec)
    if (row) rows.push(row)
  }
  if (rows.length === 0) {
    console.log('\nnenhum repositorio encontrado — nada reconstruido.')
    process.exit(0)
  }
  // The summary only echoes what ran and the worst iodb times observed — a
  // record, not a verdict. Numbers here are indicative; re-run to see them move.
  console.log('\n  RESUMO  (registro de uma execucao, nao media)')
  console.log(`    repositorios reconstruidos: ${rows.map(r => `${r.label}(${r.entries})`).join(' · ')}`)
  const worstIodbBuildPerRec = Math.max(...rows.map(r => r.iodbBuildMs / Math.max(1, r.entries)))
  const worstIodbLookupKey = Math.max(...rows.map(r => r.iodbProbe.lookupKeyMs))
  console.log(`    iodb construcao pior ms/entry: ${worstIodbBuildPerRec.toFixed(3)}`)
  console.log(`    iodb lookup-por-chave pior:    ${worstIodbLookupKey.toFixed(1)} ms`)
}

main()
