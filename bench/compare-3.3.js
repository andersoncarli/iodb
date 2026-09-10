// compare-3.3.js — feature 3.3: custo por operacao das duas engines sob o MESMO lock
//
// 3 workers, quentes, cada um martelando SO a sua propria chave (a chave e o PID,
// o valor incrementa). Nenhuma colisao de prefixo entre workers — isso isola o
// custo do protocolo do defeito de prefixo curto (feature 1.5).
//
// Cada worker:
//   1. WARM-UP — WARM escritas cronometradas fora da medicao (JIT, page cache,
//      arquivo criado, lock exercitado).
//   2. JANELA — escreve em loop ate estourar WINDOW_MS, cronometrando cada io.in()
//      E, dentro dela, as fases do lock:
//         lockWait  — ns girando no spin de acquireLock ate pegar o lock
//         critical  — ns com o lock EFETIVAMENTE seguro (resync+compute+append+commit)
//      As duas engines expoem essas fases pelo MESMO ponto:
//         - nutshell: opt { onPhase } -> repassado a appendGuarded (io-append.js)
//         - io-engine: opt { bench } -> marcas t._lockWaitNs / t._criticalNs
//      Tudo o que cada engine faz FORA do lock (projecao YAML+indice no io-engine,
//      projecao JSON no nutshell) NAO entra nessas duas fases — por desenho.
//   3. Reporta { ops, ns[], lockWait[], critical[] } como uma linha JSON.
//
// Uso:  bun bench/compare-3.3.js  [WORKERS] [WINDOW_MS] [WARM] [ROUNDS]

import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const WORKERS = Number(process.argv[2] || 3)
const WINDOW_MS = Number(process.argv[3] || 900)
const WARM = Number(process.argv[4] || 200)
const ROUNDS = Number(process.argv[5] || 5)

const ENGINE_DIR = join(import.meta.dir, '..')

const WORKER = {
  engine: `
import IO, { append } from ${JSON.stringify(join(ENGINE_DIR, 'src/io-engine.js'))}
const [, , base, warm, windowMs] = process.argv
const lockWait = [], critical = []
const io = IO(base, {
  reduce: append, initial: [], format: 'jsonl',
  bench: t => { if (t._lockWaitNs != null) lockWait.push(t._lockWaitNs)
                if (t._criticalNs != null) critical.push(t._criticalNs) },
})
io.open({ _entity: 'x' })
const KEY = String(process.pid)
let v = 0
for (let i = 0; i < Number(warm); i++) io.in({ [KEY]: v++ })   // warm-up, untimed
lockWait.length = 0; critical.length = 0                        // drop warm-up phase samples
const ns = []
const deadline = Bun.nanoseconds() + Number(windowMs) * 1e6
while (Bun.nanoseconds() < deadline) {
  const t0 = Bun.nanoseconds()
  io.in({ [KEY]: v++ })
  ns.push(Bun.nanoseconds() - t0)
}
io.close()
process.stdout.write(JSON.stringify({ ops: ns.length, ns, lockWait, critical }))
`,
  nutshell: `
import IO from ${JSON.stringify(join(ENGINE_DIR, 'nutshell/io-nutshell.js'))}
const [, , dir, warm, windowMs] = process.argv
const lockWait = [], critical = []
const io = IO('LOG', { path: dir, lock: true,
  onPhase: (name, nsv) => (name === 'lockWait' ? lockWait : critical).push(nsv) })
const KEY = 'k' + process.pid
let v = 0
for (let i = 0; i < Number(warm); i++) io.in({ [KEY]: v++ })   // warm-up, untimed
lockWait.length = 0; critical.length = 0                        // drop warm-up phase samples
const ns = []
const deadline = Bun.nanoseconds() + Number(windowMs) * 1e6
while (Bun.nanoseconds() < deadline) {
  const t0 = Bun.nanoseconds()
  io.in({ [KEY]: v++ })
  ns.push(Bun.nanoseconds() - t0)
}
process.stdout.write(JSON.stringify({ ops: ns.length, ns, lockWait, critical }))
`,
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
const stats = arr => {
  if (!arr.length) return { mean: 0, p50: 0, p95: 0, p99: 0 }
  const s = [...arr].sort((a, b) => a - b)
  return { mean: s.reduce((a, n) => a + n, 0) / s.length, p50: pct(s, 0.5), p95: pct(s, 0.95), p99: pct(s, 0.99) }
}

async function oneRound(kind) {
  const dir = mkdtempSync(join(tmpdir(), `cmp33-${kind}-`))
  try {
    const worker = join(dir, 'worker.mjs')
    writeFileSync(worker, WORKER[kind])
    const base = kind === 'engine' ? join(dir, 'LOG') : dir

    const kids = []
    for (let w = 0; w < WORKERS; w++)
      kids.push(Bun.spawn(['bun', worker, base, String(WARM), String(WINDOW_MS)],
        { stdout: 'pipe', stderr: 'pipe' }))

    const outs = await Promise.all(kids.map(async k => ({
      code: await k.exited,
      out: await new Response(k.stdout).text(),
      err: await new Response(k.stderr).text(),
    })))

    const crashed = outs.filter(o => o.code !== 0)
    if (crashed.length) throw new Error(`${kind}: ${crashed.length} worker(s) crashed\n${crashed[0].err}`)

    const per = outs.map(o => JSON.parse(o.out))
    const allNs = per.flatMap(p => p.ns).sort((a, b) => a - b)
    const totalOps = per.reduce((a, p) => a + p.ops, 0)

    return {
      totalOps,
      perWorkerOps: per.map(p => p.ops),
      aggThroughput: totalOps / (WINDOW_MS / 1000),
      op: stats(allNs),
      lockWait: stats(per.flatMap(p => p.lockWait)),
      critical: stats(per.flatMap(p => p.critical)),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function bench(kind) {
  const runs = []
  for (let r = 0; r < ROUNDS; r++) runs.push(await oneRound(kind))
  const med = f => { const s = runs.map(f).sort((a, b) => a - b); return s[s.length >> 1] }
  const phase = key => ({
    mean: med(r => r[key].mean), p50: med(r => r[key].p50),
    p95: med(r => r[key].p95), p99: med(r => r[key].p99),
  })
  return {
    kind,
    rounds: ROUNDS,
    opsMed: med(r => r.totalOps),
    throughputMed: med(r => r.aggThroughput),
    perWorkerOpsMed: [0, 1, 2].map(i => med(r => r.perWorkerOps[i] ?? 0)),
    op: phase('op'),
    lockWait: phase('lockWait'),
    critical: phase('critical'),
    runs,
  }
}

const e = await bench('engine')
const n = await bench('nutshell')

const us = ns => (ns / 1000).toFixed(1)
console.log(`\n# compare-3.3 — ${WORKERS} workers quentes · janela ${WINDOW_MS}ms · warm ${WARM} · ${ROUNDS} rodadas`)
console.log(`# cada worker martela SO a sua chave (chave = PID, valor incrementa) — sem colisao de prefixo entre workers\n`)

console.log('## custo por io.in() e vazao agregada\n')
console.log('| engine    | agg ops/s   | µs/op med | p50 µs  | p95 µs  | p99 µs  | ops/worker (med)   |')
console.log('|-----------|-------------|-----------|---------|---------|---------|--------------------|')
for (const r of [e, n])
  console.log(`| ${r.kind.padEnd(9)} | ${String(Math.round(r.throughputMed)).padStart(11)} ` +
    `| ${us(r.op.mean).padStart(9)} | ${us(r.op.p50).padStart(7)} | ${us(r.op.p95).padStart(7)} ` +
    `| ${us(r.op.p99).padStart(7)} | ${r.perWorkerOpsMed.join(' / ').padStart(18)} |`)

console.log('\n## tempo NO LOCK — mesmo ponto de medicao nas duas (io-append.js / t._*Ns)\n')
console.log('| engine    | lockWait µs (spin ate pegar)      | critical µs (lock seguro)         |')
console.log('|           |  mean / p50 / p95 / p99           |  mean / p50 / p95 / p99           |')
console.log('|-----------|----------------------------------|----------------------------------|')
for (const r of [e, n]) {
  const lw = `${us(r.lockWait.mean)} / ${us(r.lockWait.p50)} / ${us(r.lockWait.p95)} / ${us(r.lockWait.p99)}`
  const cr = `${us(r.critical.mean)} / ${us(r.critical.p50)} / ${us(r.critical.p95)} / ${us(r.critical.p99)}`
  console.log(`| ${r.kind.padEnd(9)} | ${lw.padEnd(32)} | ${cr.padEnd(32)} |`)
}
console.log()

console.log('<!-- json')
console.log(JSON.stringify({ WORKERS, WINDOW_MS, WARM, ROUNDS, engine: e, nutshell: n }, null, 2))
console.log('-->')
