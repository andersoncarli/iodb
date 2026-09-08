#!/usr/bin/env bun
/**
 * io-smoke.js — IO write stress test with chain verification
 *
 * Run:  bun smoke-io.js [size]
 */
import IO from './io-nutshell.js'
import { fromB64 } from './io-hash.js'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const size = parseInt(process.argv[2]) || 1000

const dir = mkdtempSync(join(tmpdir(), 'io-smoke-'))
const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }) } catch {} }

const io = IO('smoke', { path: dir })
const pid = process.pid
const bitHist = {}
const t0 = performance.now()

for (let i = 0; i < size; i++) {
  const key = io.in({ seq: i, pid })
  const k = key.slice(1)
  const bl = fromB64(k).toString(2).length
  bitHist[bl] = (bitHist[bl] || 0) + 1
}

const elapsed = (performance.now() - t0) / 1000
const rate = Math.round(size / elapsed)

console.log(`\n  IO Smoke — ${size} records in ${elapsed.toFixed(2)}s (${rate} rec/s)\n`)

// Bit-depth histogram
const maxC = Math.max(...Object.values(bitHist))
const bar = (n, w = 24) => '█'.repeat(Math.round(n / maxC * w)) + '░'.repeat(w - Math.round(n / maxC * w))
console.log('  depth  count     %       histogram')
console.log('  ' + '─'.repeat(52))
for (const d of Object.keys(bitHist).sort((a, b) => a - b)) {
  const c = bitHist[d]
  console.log(`  ${String(d).padEnd(6)} ${String(c).padEnd(9)} ${((c / size) * 100).toFixed(1).padStart(5)}%   ${bar(c)}`)
}

// Chain verification
process.stdout.write('\n  verifying chain... ')
const v = io.verify()
console.log(v.valid ? `✓ valid (${v.length} records)` : `✗ INVALID at ${v.failedAt}`)

// Lookup latency
if (size >= 500) {
  const recs = io.records().filter(r => r.key !== '0' && r.key !== '1')
  const keys = recs.map(r => '#' + r.key)
  const N = Math.min(10000, keys.length * 10)
  const lt0 = performance.now()
  for (let i = 0; i < N; i++) io.get(keys[i % keys.length])
  const ls = (performance.now() - lt0) / 1000
  console.log(`  lookup: ${N} in ${ls.toFixed(3)}s (${Math.floor(N / ls)} ops/s)`)
}

console.log()
cleanup()
process.exit(v.valid ? 0 : 1)
