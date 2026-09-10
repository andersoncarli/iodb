import IO, { merge, append, assign } from './io-engine.js'
import { statSync, readFileSync } from 'fs'
import { join } from 'path'

const PS = 4096

test('io-engine paged: kv round-trips like the plain path', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const base = join(dir, 'store')
    const io = IO(base, { reduce: assign, initial: {}, pageSize: 4096 })
    io.open()
    io.in({ host: 'localhost' })
    io.in({ port: 8080 })
    io.in({ port: 9090 })          // overwrite
    io.close()

    const re = IO(base, { reduce: assign, initial: {}, pageSize: 4096 })
    re.open()
    const s = re.get('#1')
    check(s.host, 'localhost')
    check(s.port, 9090)
    check('host' in s, true)
  })
})

test('io-engine paged: matches the plain path key-for-key', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const runs = {}
    for (const [label, pageSize] of [['plain', 0], ['paged', 4096]]) {
      const base = join(dir, label)
      const io = IO(base, { reduce: merge, initial: {}, pageSize })
      io.open()
      // batched: one flush for the whole seed, not one per record — the paged
      // flush is a full-file rewrite, so per-record here is O(n^2).
      for (let i = 0; i < 180; i++) io.in({ ['k' + String(i).padStart(3, '0')]: i * 2 }, { flush: 0 })
      io.flush()
      io.in({ k100: null })          // tombstone
      io.close()

      const re = IO(base, { reduce: merge, initial: {}, pageSize })
      re.open()
      const st = re.get('#1')
      runs[label] = Object.fromEntries(
        Object.keys(st).filter(k => k.startsWith('k')).sort().map(k => [k, st[k]])
      )
    }
    check(JSON.stringify(runs.paged), JSON.stringify(runs.plain))
    check('k100' in runs.paged, false)         // tombstone survived
    check(runs.paged.k000, 0)
    check(runs.paged.k179, 358)
  })
})

test('io-engine paged: append preserves order and application semantics', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const base = join(dir, 'log')
    const io = IO(base, { reduce: append, initial: [], pageSize: 4096 })
    io.open()
    for (let i = 0; i < 200; i++) io.in({ seq: i }, { flush: 0 })
    io.flush()
    io.close()

    const re = IO(base, { reduce: append, initial: [], pageSize: 4096 })
    re.open()
    const s = re.get('#1')
    // append stores each record as { <key>: payload }; genesis contributes
    // #0/#1, then 200 { seq: i } payloads under allocated keys.
    const seqs = [...s]
      .map(x => Object.values(x)[0])
      .filter(v => v && typeof v === 'object' && 'seq' in v)
      .map(v => v.seq)
    check(seqs.length, 200)
    check(seqs[0], 0)
    check(seqs[199], 199)
    check(seqs.every((v, i) => v === i), true)   // application order preserved
  })
})

test('io-engine paged: .proj file is 4096-aligned', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const base = join(dir, 'store')
    const io = IO(base, { reduce: merge, initial: {}, pageSize: 4096 })
    io.open()
    for (let i = 0; i < 400; i++) io.in({ ['key' + String(i).padStart(4, '0')]: { n: i, pad: 'x'.repeat(30) } }, { flush: 0 })
    io.flush()
    io.close()

    const size = statSync(base + '.proj').size
    check(size % PS === 0, true)
    const raw = readFileSync(base + '.proj')
    const header = JSON.parse(raw.toString('utf8', 0, raw.indexOf(0)))
    check(header.magic, 'PAGEDPROJ')
    check(header.pages.length > 1, true)         // genuinely multi-page
  })
})

test('io-engine paged: .yaml still readable and correct', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const base = join(dir, 'store')
    const io = IO(base, { reduce: merge, initial: {}, pageSize: 4096 })
    io.open()
    io.in({ alpha: 1, beta: 2 })
    io.close()

    const yaml = readFileSync(base + '.yaml', 'utf8')
    check(yaml.includes('alpha: 1'), true)
    check(yaml.includes('beta: 2'), true)
  })
})

test('io-engine paged: verify() chain stays valid', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const base = join(dir, 'store')
    const io = IO(base, { reduce: merge, initial: {}, pageSize: 4096 })
    io.open()
    for (let i = 0; i < 50; i++) io.in({ ['x' + i]: i })
    io.close()

    const re = IO(base, { reduce: merge, initial: {}, pageSize: 4096 })
    re.open()
    check(re.verify().valid, true)
  })
})
