// io-engine.bench.js — feature 2.1
//
// Makes "sub-millisecond critical section" a checkable claim instead of one
// inferred from test-failure counts (which turned out to be noise — see
// plans/2-pages/2.1-benchmark-de-secao-critica.md for why).
//
// Metric that matters: TIME WITH THE LOCK HELD — from acquireLock() returning
// to the release rename in flush(). That's the number 2.2 must shrink, and
// the one that must stop growing with store size once it does.
//
// Grid: store size (1k / 10k / 100k records already on disk) × concurrency
// (1 / 8 processes hammering the same base). 100k is where the O(n) cost of
// saveIndex()/flushYaml() rewriting the whole file should show up as a
// visibly larger p95 than at 1k.
//
// Usage:
//   bun io-engine.bench.js            — run the full 6-point grid, print table
//   bun io-engine.bench.js --quick    — 1k×1 and 1k×8 only, for fast iteration
//   bun ../utest/utest.js io-engine.bench.js --force   — runs the sanity test below
//
// The instrumentation lives in io-engine.js's flush(), behind an optional
// `bench` callback passed to IO(). When absent (normal use, and every other
// test/file in the repo), flush() pays for a single falsy `if` per phase and
// no allocation — see the `t ? ... : null` guards there.

import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import IO, { merge } from './io-engine.js'

const PHASES = [
  ['precompute', 'precomputeStart', 'precomputeEnd'],
  ['lockWait', 'lockWaitStart', 'lockAcquired'],
  ['verifyStat', 'verifyStatStart', 'verifyStatEnd'],
  ['recompute', 'recomputeStart', 'recomputeEnd'],   // 0 unless another writer raced in
  ['append', 'appendStart', 'appendEnd'],
  ['publish', 'publishStart', 'lockReleased'],       // saveIndex / flushYaml + release rename
]
// The number the whole frente is about: from lock acquired to lock released.
const CRITICAL = ['critical', 'lockAcquired', 'lockReleased']

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[idx]
}

function summarize(samples) {
  // samples: array of `t` marks objects collected from flush()'s bench hook
  const out = {}
  for (const [label, start, end] of [...PHASES, CRITICAL]) {
    const durations = samples
      .map(t => (t[start] != null && t[end] != null) ? t[end] - t[start] : null)
      .filter(d => d != null)
      .sort((a, b) => a - b)
    out[label] = {
      n: durations.length,
      p50: percentile(durations, 0.50),
      p95: percentile(durations, 0.95),
      p99: percentile(durations, 0.99),
    }
  }
  return out
}

// Seeding one flush() per record is the O(n) cost this whole front measures —
// each flush rewrites .index/.yaml in full, so N sequential single-record
// flushes cost O(n^2) in wall time (measured: a marginal write at 2k records
// already took ~5ms; at 100k it would take tens of ms EACH just to seed).
// Batching writes with in(payload, {flush:0}) + one flush() per BATCH_SIZE
// avoids paying that per-record: the batch itself is O(1) in record count
// (measured ~150-200ms per 1000-record batch, flat up to 100k total), because
// the projection is built once for the whole batch instead of once per write.
const SEED_BATCH = 1000

// Seeding gets its own budget, separate from the measurement window: it is
// setup, not signal, but it is also where an unfenced cell spends its minutes.
const SEED_BUDGET_MS = 1500

// Seeding is fenced on time too, and reports what it actually reached. The
// store size is a TARGET, not a promise: on a slow machine a cell settles for a
// smaller store rather than blowing the budget, and the printed size says which
// store the numbers describe. A benchmark that lies about its inputs to hit a
// round number is worse than one that reports a smaller store honestly.
function seed(io, count, budgetMs = SEED_BUDGET_MS) {
  const deadline = Date.now() + budgetMs
  let written = 0
  for (let b = 0; b < count; b += SEED_BATCH) {
    if (Date.now() >= deadline) break
    const n = Math.min(SEED_BATCH, count - b)
    for (let i = 0; i < n; i++) io.in({ ['seed' + (b + i)]: i }, { flush: 0 })
    io.flush()
    written += n
  }
  return written
}

// Per-cell time budget. A benchmark that takes minutes is not a slow benchmark,
// it is a benchmark nobody runs — and one that never becomes a regression guard.
// The target band is 100-1000ms per cell: long enough for percentiles to mean
// something, short enough that the whole grid stays a routine command.
const CELL_BUDGET_MS = 800

// ── Single-process run: seed N records (batched), then marginal single-record
// flushes, each timed individually — that's the metric: cost of ONE real write
// once the store already holds `seedCount` records.

// TIME FENCE, not a cycle count. A fixed number of writes makes the cell's
// duration a function of how slow the engine is — exactly the quantity being
// measured — so the cheap cells finish instantly and the expensive ones blow
// the budget. Fencing on elapsed time inverts that: every cell costs the same
// wall clock, and it is the SAMPLE COUNT that varies and reports how fast the
// engine was. `writes` becomes a ceiling, not a target.
function runSingleProcess(dir, seedCount, writes, budgetMs = CELL_BUDGET_MS) {
  const base = join(dir, 'LOG')
  const samples = []
  const io = IO(base, { reduce: merge, initial: {}, bench: (t) => samples.push(t) })
  io.open({ _entity: 'bench' })
  const actualSize = seed(io, seedCount)
  samples.length = 0   // discard seeding batches, keep only the marginal writes below
  const deadline = Date.now() + budgetMs
  let i = 0
  while (i < writes && Date.now() < deadline) io.in({ ['k' + i]: i }), i++
  io.close()
  return { samples, actualSize }
}

// ── Multi-process run: seed once, then spawn PROCS workers writing concurrently ─
function workerSrc(engine) {
  return `
import IO, { merge } from ${JSON.stringify(engine)};
const [, , base, writes, outFile] = process.argv;
const samples = [];
const io = IO(base, { reduce: merge, initial: {}, bench: (t) => samples.push(t) });
io.open();
// Same time fence as the single-process path: writes is a ceiling, the clock
// decides. Otherwise the slowest cell — which is the one under contention —
// is exactly the one that runs longest.
const deadline = Date.now() + Number(process.argv[5] || 800);
for (let i = 0; i < Number(writes) && Date.now() < deadline; i++) {
  io.in({ ['p' + process.pid + '_' + i]: i });
}
io.close();
require('fs').writeFileSync(outFile, JSON.stringify(samples));
`
}

async function runMultiProcess(dir, seedCount, procs, writesPerProc) {
  const base = join(dir, 'LOG')
  const seedIo = IO(base, { reduce: merge, initial: {} })
  seedIo.open({ _entity: 'bench' })
  const actualSize = seed(seedIo, seedCount)   // batched — see `seed()` for why one-flush-per-record isn't viable here
  seedIo.close()

  const worker = join(dir, 'worker.mjs')
  writeFileSync(worker, workerSrc(join(import.meta.dir, 'io-engine.js')))

  const kids = []
  const outFiles = []
  for (let p = 0; p < procs; p++) {
    const outFile = join(dir, `out.${p}.json`)
    outFiles.push(outFile)
    kids.push(Bun.spawn(['bun', worker, base, String(writesPerProc), outFile, String(CELL_BUDGET_MS)], {
      stdout: 'pipe', stderr: 'pipe',
    }))
  }
  const results = await Promise.all(kids.map(async (k) => ({
    code: await k.exited,
    err: await new Response(k.stderr).text(),
  })))
  // A worker hitting `[IO] Lock timeout` under 8-way contention at larger store
  // sizes is not a bench bug — it's the exact O(n)-critical-section symptom
  // this feature exists to measure (see plans/2-pages/2.1). Record it as data
  // (`timedOut`) instead of throwing, so the grid finishes and the number
  // makes it into the baseline.
  const timedOut = results.filter(r => r.code !== 0 && /Lock timeout/.test(r.err)).length
  const otherFailures = results.filter(r => r.code !== 0 && !/Lock timeout/.test(r.err))
  if (otherFailures.length) {
    throw new Error(`${otherFailures.length}/${procs} bench workers failed (non-timeout): ${otherFailures[0].err.slice(0, 500)}`)
  }

  let samples = []
  for (const outFile of outFiles) {
    if (existsSync(outFile)) samples = samples.concat(JSON.parse(require('fs').readFileSync(outFile, 'utf8')))
  }
  return { samples, timedOut, procs, actualSize }
}

function fmtRow(label, s) {
  return `| ${label.padEnd(11)} | ${String(s.n).padStart(5)} | ${s.p50.toFixed(2).padStart(7)} | ${s.p95.toFixed(2).padStart(7)} | ${s.p99.toFixed(2).padStart(7)} |`
}

function printCell(storeSize, procs, summary, elapsedMs, totalWrites, timedOut) {
  const timeoutNote = timedOut ? `, ${timedOut}/${procs} workers hit lock timeout` : ''
  console.log(`\n### store=${storeSize} procs=${procs} (${totalWrites} writes, ${elapsedMs}ms wall, ${(totalWrites / (elapsedMs / 1000)).toFixed(0)} writes/s${timeoutNote})\n`)
  console.log('| phase       |   n   |  p50ms |  p95ms |  p99ms |')
  console.log('|-------------|-------|--------|--------|--------|')
  for (const [label] of [...PHASES, CRITICAL]) console.log(fmtRow(label, summary[label]))
}

async function runGrid(sizes, concurrencies, writesPerCell) {
  const results = []
  const overBudget = []
  for (const size of sizes) {
    for (const procs of concurrencies) {
      const dir = mkdtempSync(join(tmpdir(), 'iodb-bench-'))
      try {
        const start = Date.now()
        let samples, timedOut = 0, actualSize = size
        if (procs === 1) {
          ;({ samples, actualSize } = runSingleProcess(dir, size, writesPerCell))
        } else {
          const perProc = Math.ceil(writesPerCell / procs)
          ;({ samples, timedOut, actualSize } = await runMultiProcess(dir, size, procs, perProc))
        }
        const elapsed = Date.now() - start
        const summary = summarize(samples)
        printCell(actualSize, procs, summary, elapsed, samples.length, timedOut)
        results.push({ size: actualSize, procs, summary, elapsed, n: samples.length, timedOut })
        if (elapsed > CELL_BUDGET_MS) overBudget.push({ size, procs, elapsed })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  }
  if (overBudget.length) {
    const multi = overBudget.filter(c => c.procs > 1)
    console.log(`\n⚠️  ${overBudget.length} celula(s) acima do orcamento de ${CELL_BUDGET_MS}ms:`)
    for (const c of overBudget)
      console.log(`    size=${c.size} procs=${c.procs}: ${(c.elapsed / 1000).toFixed(1)}s`)
    if (multi.length) {
      console.log('')
      console.log('    Celulas multi-processo nao cabem no orcamento por um limite do ENGINE,')
      console.log('    nao do bench: sob contencao os workers esperam no lock, cujo timeout')
      console.log('    minimo e 1000ms (io-append.js lockTimeout). Fencear o laco de escrita')
      console.log('    nao ajuda — o tempo e gasto ESPERANDO, nao escrevendo. E a feature 2.3')
      console.log('    (lockfile dedicado) que ataca isso; ate la, o estouro e o proprio dado.')
    }
  }
  return results
}

// ── CLI entry point ─────────────────────────────────────────────────────────
// Guarded so `bun ../utest/utest.js io-engine.bench.js` (which imports this
// file for the sanity test below) does not also run the whole grid.
const isMain = import.meta.main
if (isMain) {
  // Default grid is chosen to FIT the per-cell budget, not to be impressive.
  // 100k stayed in the 2.1 baseline because that baseline was the point — the
  // 733ms critical section it recorded is exactly what 2.2 set out to kill. But
  // a cell that takes a minute cannot be run routinely, so 100k is now opt-in
  // via --full: the default grid has to stay cheap enough to actually run.
  const quick = process.argv.includes('--quick')
  const full = process.argv.includes('--full')
  //
  // Sizes are chosen so a cell fits the time budget, and the ceiling is set by
  // open(), not by the writes being measured: a worker's open() does syncFrom(0)
  // — a full projection rebuild — which costs 15ms at 1k, 260ms at 10k and
  // 1176ms at 20k. With 8 workers each paying that before writing a single
  // record, anything past ~5k cannot fit an 800ms cell no matter how the write
  // loop is fenced. That ceiling is exactly what features 2.4/2.5 remove; until
  // then the honest move is to measure sizes that fit and say why.
  //
  // --full keeps the old 1k/10k/100k grid for the rare deep run. It will blow
  // the budget, loudly, by design.
  const sizes = quick ? [1000] : full ? [1000, 10000, 100000] : [500, 2000, 5000]
  const concurrencies = [1, 8]
  const writesPerCell = quick ? 100 : full ? 200 : 200
  console.log(`io-engine.bench.js — grid: sizes=${sizes.join(',')} concurrencies=${concurrencies.join(',')} writes/cell=${writesPerCell}`)
  await runGrid(sizes, concurrencies, writesPerCell)
}

// ── Sanity test: instrumentation must not change engine behaviour ──────────
// Runs under utest (bun ../utest/utest.js io-engine.bench.js --force).
if (globalThis.test) {
  test('2.1 bench — phase marks sum to <= wall time, instrumentation is inert', async ({ check }) => {
    const dir = mkdtempSync(join(tmpdir(), 'iodb-bench-test-'))
    try {
      const base = join(dir, 'LOG')
      const samples = []
      const io = IO(base, { reduce: merge, initial: {}, bench: (t) => samples.push(t) })
      io.open({ _entity: 'x' })
      const wallStart = Date.now()
      for (let i = 0; i < 20; i++) io.in({ ['k' + i]: i })
      const wallEnd = Date.now()
      io.close()

      check(samples.length, 20)
      // Every recorded flush must have well-formed, monotonic marks: a phase
      // can't end before it starts, and the whole flush can't outrun the wall
      // clock window it happened in.
      let allMonotonic = true
      for (const t of samples) {
        if (t.lockAcquired < t.precomputeEnd) allMonotonic = false
        if (t.lockReleased < t.lockAcquired) allMonotonic = false
        if (t.appendEnd < t.appendStart) allMonotonic = false
        if (t.precomputeStart < wallStart - 5 || t.lockReleased > wallEnd + 5) allMonotonic = false
      }
      check(allMonotonic, true)

      // Instrumentation must be inert: same reducer, same input, with vs.
      // without `bench` must produce an identical projection.
      const base2 = join(dir, 'LOG2')
      const ioA = IO(base2, { reduce: merge, initial: {}, entity: 'x' })
      ioA.open({ _entity: 'x' })
      for (let i = 0; i < 20; i++) ioA.in({ ['k' + i]: i })
      ioA.close()

      const base3 = join(dir, 'LOG3')
      const ioB = IO(base3, { reduce: merge, initial: {}, entity: 'x', bench: () => {} })
      ioB.open({ _entity: 'x' })
      for (let i = 0; i < 20; i++) ioB.in({ ['k' + i]: i })
      ioB.close()

      check(JSON.stringify(ioA.state()), JSON.stringify(ioB.state()))
      check(ioA.verify().valid, true)
      check(ioB.verify().valid, true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

export { runGrid, summarize, runSingleProcess, runMultiProcess }
