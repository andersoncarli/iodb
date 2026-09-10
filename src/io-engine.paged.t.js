import IO, { merge, append, assign } from './io-engine.js'
import { readTrailer } from '../pagedtext/pagedtext.js'
import { statSync, readFileSync } from 'fs'
import { join } from 'path'

const PS = 4096

// Os tres testes que escrevem em volume levam { timeout: 5000 }. Desde que o
// batching saiu (feature 2.0) cada registro faz um commit REAL, com fsync, e
// centenas deles nao cabem no default de 1000ms.
//
// O teto acompanha trabalho real, nao mascara crescimento. O custo por registro
// e PLANO — 100 registros: 1.10ms/rec, 200: 1.00, 400: 0.96 — que e exatamente a
// propriedade O(paginas sujas): o custo de uma escrita nao cresce com o tamanho
// do store. Se ele voltar a crescer, o teto estoura e o teste acusa.
//
// O preco disso e que este arquivo saiu de ~1s para ~8s. E deliberado: o caminho
// que o engine usa de verdade e uma escrita por registro, e era ele que ficava
// sem cobertura enquanto os testes batchavam para contornar a reescrita total.

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
      // NOT batched. Before feature 2.0 the paged flush was a full-file
      // rewrite, so one flush per record was O(n^2) and these tests had to
      // batch around it. The commit is now O(dirty pages), so the per-record
      // path is the one worth exercising.
      for (let i = 0; i < 180; i++) io.in({ ['k' + String(i).padStart(3, '0')]: i * 2 })
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
}, { timeout: 5000 })

test('io-engine paged: append preserves order and application semantics', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const base = join(dir, 'log')
    const io = IO(base, { reduce: append, initial: [], pageSize: 4096 })
    io.open()
    for (let i = 0; i < 200; i++) io.in({ seq: i })
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
}, { timeout: 5000 })

test('io-engine paged: .proj file is 4096-aligned', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const base = join(dir, 'store')
    const io = IO(base, { reduce: merge, initial: {}, pageSize: 4096 })
    io.open()
    for (let i = 0; i < 400; i++) io.in({ ['key' + String(i).padStart(4, '0')]: { n: i, pad: 'x'.repeat(30) } })
    io.close()

    const size = statSync(base + '.proj').size
    check(size % PS === 0, true)
    const raw = readFileSync(base + '.proj')
    const header = JSON.parse(raw.toString('utf8', 0, raw.indexOf(0)))
    check(header.magic, 'PAGEDTEXT')
    // O header e genesis; a contagem de paginas esta no rodape.
    check(readTrailer(base + '.proj').pages.length > 1, true)   // genuinely multi-page
  })
}, { timeout: 5000 })

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
