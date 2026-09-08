#!/usr/bin/env bun
/**
 * io-demo.js — Interactive demo of IO reactive capabilities
 *
 * Run:  bun demo-io.js [rounds]
 *
 * Shows:
 *   1. Ping-Pong reactivity benchmark (measures .out() latency)
 *   2. Progressive hash keys growing with collection size
 *   3. Producer/consumer pattern
 *   4. Multi-stream fan-out
 *   5. Chain verification after all writes
 */
import IO from './io-nutshell.js'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const C = { r: '\x1b[0m', b: '\x1b[1m', d: '\x1b[2m', g: '\x1b[32m', y: '\x1b[33m', c: '\x1b[36m', m: '\x1b[35m' }

const dir = mkdtempSync(join(tmpdir(), 'io-demo-'))
const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
process.on('exit', cleanup)

const pad = (s, n) => String(s).padEnd(n)
const rpad = (s, n) => String(s).padStart(n)
const pct = (sorted, p) => sorted[Math.max(0, Math.ceil(sorted.length * p / 100) - 1)]

console.log(`\n  ${C.b}IO Nutshell — Reactive Demo${C.r}`)
console.log(`  ${C.d}${'─'.repeat(55)}${C.r}\n`)

// ── 1. Ping-Pong Reactivity Benchmark ────────────────────────────

const ROUNDS = parseInt(process.argv[2]) || 1000

console.log(`  ${C.b}1. Ping-Pong Reactivity${C.r}  ${C.d}(${ROUNDS} rounds)${C.r}`)
console.log(`     ${C.d}Two IO streams, each .out() triggers a write to the other${C.r}\n`)

const ping = IO('ping', { path: dir, reduce: (a, r) => [...a, r], initial: [] })
const pong = IO('pong', { path: dir, reduce: (a, r) => [...a, r], initial: [] })

let rallies = 0
const latencies = []
let t0 = 0

// Pong replies to every ping
pong.out(({ payload }) => {
  if (payload.type === 'pong' && rallies < ROUNDS) {
    const lat = performance.now() - payload.sent
    latencies.push(lat)
    rallies++
    if (rallies < ROUNDS) {
      ping.in({ type: 'ping', n: rallies, sent: performance.now() })
    }
  }
})

// Ping triggers a pong
ping.out(({ payload }) => {
  if (payload.type === 'ping') {
    pong.in({ type: 'pong', n: payload.n, sent: payload.sent })
  }
})

// Serve!
t0 = performance.now()
ping.in({ type: 'ping', n: 0, sent: performance.now() })

const totalMs = performance.now() - t0
const sorted = latencies.sort((a, b) => a - b)

console.log(`     ${C.g}✓${C.r} ${rallies} round-trips in ${totalMs.toFixed(1)}ms`)
console.log(`     ${C.d}avg: ${(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(3)}ms` +
  `  p50: ${pct(sorted, 50).toFixed(3)}ms` +
  `  p95: ${pct(sorted, 95).toFixed(3)}ms` +
  `  p99: ${pct(sorted, 99).toFixed(3)}ms${C.r}`)
console.log(`     ${C.d}throughput: ${Math.round(rallies / (totalMs / 1000))} round-trips/s${C.r}`)
console.log(`     ${C.d}records: ping=${ping.get().length}  pong=${pong.get().length}${C.r}`)

// ── 2. Progressive hash keys ─────────────────────────────────────

console.log(`\n  ${C.b}2. Progressive Hash Keys${C.r}`)
console.log(`     ${C.d}Keys grow logarithmically as the collection grows${C.r}\n`)

const store = IO('keys', { path: dir })
const keys = []
for (let i = 0; i < 64; i++) {
  const k = store.in({ i, t: Date.now() })
  keys.push(k.slice(1)) // remove '#'
}

const sample = [0, 1, 3, 7, 15, 31, 63]
for (const idx of sample) {
  const k = keys[idx]
  const bar = '█'.repeat(k.length) + '░'.repeat(Math.max(0, 8 - k.length))
  console.log(`     rec ${rpad(idx, 3)}  key: ${C.y}${pad(k, 10)}${C.r}  len: ${k.length}  ${C.g}${bar}${C.r}`)
}

// ── 3. Producer / Consumer pattern ───────────────────────────────

console.log(`\n  ${C.b}3. Producer / Consumer${C.r}\n`)

const tasks = IO('tasks', { path: dir })
const completed = []

tasks.out(({ key, payload }) => {
  if (payload.status === 'done') {
    completed.push(payload.name)
    console.log(`     ${C.g}✓${C.r} ${payload.name} completed  ${C.d}(#${key})${C.r}`)
  } else {
    console.log(`     ${C.y}⏳${C.r} ${payload.name} queued     ${C.d}(#${key})${C.r}`)
  }
})

tasks.in({ name: 'build',  status: 'pending' })
tasks.in({ name: 'test',   status: 'pending' })
tasks.in({ name: 'build',  status: 'done' })
tasks.in({ name: 'deploy', status: 'pending' })
tasks.in({ name: 'test',   status: 'done' })
tasks.in({ name: 'deploy', status: 'done' })

console.log(`\n     ${C.d}completed: [${completed.join(', ')}]${C.r}`)

// ── 4. Multi-stream fan-out ──────────────────────────────────────

console.log(`\n  ${C.b}4. Multi-Stream Fan-Out${C.r}`)
console.log(`     ${C.d}One event, multiple independent consumers${C.r}\n`)

const events = IO('events', { path: dir, reduce: (acc, rec) => [...acc, rec], initial: [] })
const log1 = [], log2 = [], log3 = []

events.out(({ payload }) => log1.push(payload.type))
events.out(({ payload }) => { if (payload.type === 'error') log2.push(payload) })
events.out(({ payload }) => log3.push(payload.ts))

events.in({ type: 'info',    msg: 'started',       ts: 1 })
events.in({ type: 'info',    msg: 'processing',    ts: 2 })
events.in({ type: 'error',   msg: 'disk full',     ts: 3 })
events.in({ type: 'info',    msg: 'retrying',      ts: 4 })
events.in({ type: 'warning', msg: 'slow response', ts: 5 })

console.log(`     logger:     [${log1.join(', ')}]`)
console.log(`     errors:     [${log2.map(e => e.msg).join(', ')}]`)
console.log(`     timestamps: [${log3.join(', ')}]`)

// ── 5. Chain Verification ────────────────────────────────────────

console.log(`\n  ${C.b}5. Chain Integrity${C.r}\n`)

for (const name of ['ping', 'pong', 'keys', 'tasks', 'events']) {
  const isAppend = name === 'ping' || name === 'pong' || name === 'events'
  const io = IO(name, { path: dir, reduce: isAppend ? (a, r) => [...a, r] : undefined, initial: isAppend ? [] : {} })
  const v = io.verify()
  const icon = v.valid ? `${C.g}✓${C.r}` : `\x1b[31m✗${C.r}`
  console.log(`     ${icon} ${pad(name, 8)} ${rpad(v.length, 5)} records`)
}

// ── Done ─────────────────────────────────────────────────────────

console.log(`\n  ${C.d}${'─'.repeat(55)}${C.r}`)
console.log(`  ${C.g}${C.b}Demo complete.${C.r} ${C.d}tmp: ${dir}${C.r}\n`)
