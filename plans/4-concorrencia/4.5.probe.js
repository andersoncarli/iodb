// Probe da 4.5 — o `.proj` deixa de ser arbitrado por TAMANHO e passa a ser
// arbitrado por OFFSET.
//
// A prova e em registros contados apos reabrir, nos dois lados do mesmo guarda:
// o arquivo que duplicava e o arquivo atrasado que perdia o delta.

import IO, { merge, append } from '../../src/io-engine.js'
import { readTrailer } from '../../pagedtext/pagedtext.js'
import { mkdtempSync, statSync, copyFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'p45-'))

// --- 1. DUPLICACAO: o defeito que estava vivo ---------------------------
// Com pagina < 4096, uma projecao de VARIAS paginas media menos que 4096
// bytes. O guarda literal a lia como vazia e reaplicava o log inteiro.
const N = 40
let todosOk = true
for (const pageSize of [128, 256, 512, 1024, 2048, 4096]) {
  const base = join(dir, 'log' + pageSize)
  const io = IO(base, { reduce: append, initial: [], pageSize })
  io.open()
  for (let i = 0; i < N; i++) io.in({ seq: i })
  io.close()
  const paginas = statSync(base + '.proj').size / pageSize

  const re = IO(base, { reduce: append, initial: [], pageSize })
  re.open()
  const seqs = [...re.get('#1')]
    .map(x => Object.values(x)[0])
    .filter(v => v && typeof v === 'object' && 'seq' in v)
    .map(v => v.seq)
  const ok = seqs.length === N && new Set(seqs).size === N && seqs.every((v, i) => v === i)
  if (!ok) todosOk = false
  console.log(`ps=${String(pageSize).padStart(4)} paginas=${String(paginas).padStart(3)} registros=${String(seqs.length).padStart(3)} esperado=${N} ok=${ok}`)
}
console.log('sem duplicacao em nenhum pageSize:', todosOk)

// --- 2. O OFFSET EXISTE E PERSISTE --------------------------------------
// Sem isso nao ha o que arbitrar: e o numero que substitui o tamanho.
const b2 = join(dir, 'off')
const io2 = IO(b2, { reduce: merge, initial: {}, pageSize: 256 })
io2.open()
for (let i = 0; i < 20; i++) io2.in({ ['k' + i]: { v: i } })
io2.close()
const logSize = statSync(b2 + '.dash').size
const projOff = readTrailer(b2 + '.proj')?.logOffset
console.log(`dash=${logSize} proj.logOffset=${projOff} cobre o log inteiro=${projOff === logSize}`)

// --- 3. O `.proj` ATRASADO recupera o delta ------------------------------
// O gap que o codigo antigo declarava em prosa e NAO fechava: ele pulava o
// replay inteiro e as chaves que faltavam sumiam em silencio.
const b3 = join(dir, 'stale')
const pad = 'x'.repeat(40)
const a = IO(b3, { reduce: merge, initial: {}, pageSize: 4096 })
a.open()
for (let i = 0; i < 80; i++) a.in({ ['k' + String(i).padStart(3, '0')]: { v: i, pad } })
a.close()
copyFileSync(b3 + '.proj', b3 + '.proj.velho')
const offVelho = readTrailer(b3 + '.proj')?.logOffset

const b = IO(b3, { reduce: merge, initial: {}, pageSize: 4096 })
b.open()
for (let i = 80; i < 100; i++) b.in({ ['k' + String(i).padStart(3, '0')]: { v: i, pad } })
b.close()
copyFileSync(b3 + '.proj.velho', b3 + '.proj')

const dashFinal = statSync(b3 + '.dash').size
const projBytes = statSync(b3 + '.proj').size
const re3 = IO(b3, { reduce: merge, initial: {}, pageSize: 4096 })
re3.open()
const ks = Object.keys(re3.get('#1')).filter(k => k.startsWith('k'))
console.log(`proj atrasado: ${projBytes} bytes (> 4096: ${projBytes > 4096}), offset=${offVelho}, dash=${dashFinal}`)
console.log(`chaves apos reabrir: ${ks.length} esperado=100 sem duplicata=${new Set(ks).size === ks.length}`)
