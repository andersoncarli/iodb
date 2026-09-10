/**
 * Sonda de benchmark da feature 2.0 — o custo por escrita e PLANO.
 *
 * Fence de TEMPO, nao de ciclos: um numero fixo de escritas faz a duracao da
 * celula depender de quao lento o motor esta, que e justamente o que se quer
 * medir. A regra e a mesma da 4.2 (CELL_BUDGET_MS + `Date.now() < deadline`).
 *
 * A celula escreve ate estourar 900ms sobre stores JA SEMEADOS em tamanhos
 * diferentes. A leitura que importa nao e a vazao absoluta — e se ms/escrita
 * cresce com o tamanho do arquivo. Com a reescrita total de antes da 2.0 ele
 * cresceria linearmente. Com escrita O(paginas sujas) ele fica plano, e e esse
 * "plano" que e a entrega da feature.
 */
import { PagedText } from '../../pagedtext/pagedtext.js'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CELL_BUDGET_MS = 900
const SIZES = [5000, 50000, 200000]

// O caso que importa e o dos docs: CSV/JSONL append-only, arquivo de muitos GB,
// escrita na cauda. Uma linha de CSV realista.
const row = i => `${i},user${i},user${i}@example.com,2026-03-07,active,${i * 7}`

console.log(`fence: ${CELL_BUDGET_MS}ms por celula (tempo, nao ciclos)`)
console.log('caso: CSV append-only — a aplicacao fundamental do pagedtext')
console.log()
console.log('   linhas | arquivo |  pags | appends |    ms | appends/s | ms/append | pags/append | ckpt pags')
console.log('  --------|---------|-------|---------|-------|-----------|-----------|-------------|----------')

const rows = []
for (const seed of SIZES) {
  const dir = mkdtempSync(join(tmpdir(), 'pagedtext-bench-'))
  try {
    const file = join(dir, 'users.csv')
    // checkpointEvery: 200 — o rodape vira checkpoint em vez de volatil.
    const t = PagedText({ path: file, pageSize: 4096, checkpointEvery: 200 })
    const seeded = []
    for (let i = 0; i < seed; i++) seeded.push(row(i))
    t._store.replaceAll(seeded)
    t._store.flush()

    const mb = (statSync(file).size / 1048576).toFixed(1)
    // Aquece: o primeiro append apos a semeadura paga custos de abertura que
    // nao sao do regime permanente que se quer medir.
    for (let k = 0; k < 20; k++) t.push(row(seed + k))

    // Separa o append comum do checkpoint. Media-los juntos esconde as duas
    // coisas: o append e constante, o checkpoint e periodico e proporcional ao
    // arquivo. Sao custos de naturezas diferentes e leem-se separados.
    let n = 0, pages = 0, ckpts = 0, ckptPages = 0
    const deadline = Date.now() + CELL_BUDGET_MS
    const t0 = Date.now()
    while (Date.now() < deadline) {
      t.push(row(seed + 20 + n))
      const w = t._store.lastWrite
      if (w.checkpoint) { ckpts++; ckptPages += w.pages } else { pages += w.pages; n++ }
    }
    const ms = Date.now() - t0
    const pagesPer = pages / n
    rows.push({ seed, mb, n, ms, perMs: ms / n, pagesPer, ckpts,
                ckptPer: ckpts ? ckptPages / ckpts : 0, pageCount: t._store.pageCount() })
    console.log(
      `  ${String(seed).padStart(7)} | ${String(mb + 'MB').padStart(7)} | ` +
      `${String(t._store.pageCount()).padStart(5)} | ${String(n).padStart(7)} | ` +
      `${String(ms).padStart(5)} | ${String(Math.round(n / ms * 1000)).padStart(9)} | ` +
      `${(ms / n).toFixed(3).padStart(9)} | ${pagesPer.toFixed(2).padStart(11)} | ` +
      `${(ckpts ? (ckptPages / ckpts).toFixed(0) : '-').padStart(9)}`
    )
    t.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const first = rows[0], last = rows.at(-1)
const fileGrowth = last.pageCount / first.pageCount
const pageGrowth = last.pagesPer / first.pagesPer
console.log()
console.log(`arquivo cresceu ${fileGrowth.toFixed(0)}x (${first.mb}MB -> ${last.mb}MB)`)
console.log(`paginas por APPEND variou ${pageGrowth.toFixed(2)}x (${first.pagesPer.toFixed(2)} -> ${last.pagesPer.toFixed(2)})`)
console.log(`paginas por CHECKPOINT: ${first.ckptPer.toFixed(0)} -> ${last.ckptPer.toFixed(0)} (proporcional ao arquivo, a cada 200 flushes)`)
console.log()
console.log('O header e genesis e nao e reescrito. O rodape de stats vai no fim e,')
console.log('em regime de checkpoint, so a cada N flushes — entre eles o append escreve')
console.log('UMA pagina de dados. O que o checkpoint deixa para tras e reconstruido na')
console.log('abertura lendo as paginas, que sao autodescritivas.')
console.log(`veredito: ${pageGrowth < 2 ? 'PLANO — o custo do append nao cresce com o arquivo' : 'AINDA CRESCE'}`)
