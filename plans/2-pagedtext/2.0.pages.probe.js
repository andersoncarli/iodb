/**
 * Sonda visual da feature 2.0 — o padding de uma pagina, em dois editores.
 *
 * Dois TextBuffer do ~/soml/scl/editor sobre o MESMO arquivo paginado:
 *
 *   ESQUERDA  os bytes crus da pagina, com o filling visivel
 *   DIREITA   as linhas logicas que o pagedtext devolve pela API
 *
 * O contraste e o argumento: o filling e capacidade FISICA dentro da pagina e
 * nunca aparece na face logica. E a autoridade sobre onde a pagina termina e a
 * contagem de linhas do header, nao a corrida de espacos — um editor que
 * aparasse os espacos finais nao mudaria uma linha logica sequer.
 */
import { PagedText } from '../../pagedtext/pagedtext.js'
import { TextBuffer } from '../../../soml/scl/editor/text-buffer.js'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PS = 4096
const W = 38                       // largura de cada coluna
const PAGE = Number(process.argv[2] ?? 0)

const vis = s => s.replace(/\t/g, '<TAB>').replace(/ /g, '·')
const cut = s => (s.length > W ? s.slice(0, W - 1) + '…' : s)
const pad = s => cut(s).padEnd(W)

const dir = mkdtempSync(join(tmpdir(), 'pagedtext-vis-'))
try {
  const file = join(dir, 'store.txt')
  const t = PagedText({ path: file, pageSize: PS })
  const lines = []
  // Linhas LARGAS de proposito: poucas cabem por pagina, entao a sobra ate o
  // limite de 4096 e substancial e o filling fica visivel. Com linhas curtas a
  // pagina enche de conteudo e a sobra vira uma migalha que nao mostra nada.
  for (let i = 0; i < 40; i++)
    lines.push(`k${String(i).padStart(4, '0')}\t{"n":${i},"pad":"${'x'.repeat(220)}"}`)
  t._store.replaceAll(lines)
  t._store.flush()

  const info = t._store.pagesInfo()[PAGE]
  const header = t._store.pageCount()

  // ESQUERDA: os bytes crus dessa pagina, direto do disco, num TextBuffer.
  const raw = readFileSync(file)
  const bytes = raw.subarray(info.offset, info.offset + info.extent * PS)
  const left = new TextBuffer(bytes.toString('utf8'))

  // DIREITA: as linhas logicas, pela API — o que um consumidor enxerga.
  const right = new TextBuffer(t._store.readPage(PAGE).join('\n'))

  const L = left.getLines()
  const R = right.getLines()

  console.log(`arquivo: ${header} paginas de dados, pagina ${PAGE} @ byte ${info.offset}`)
  console.log(`header diz: ${info.lines} linhas · ${info.bytes} bytes de conteudo · extent ${info.extent}`)
  console.log()
  console.log(pad('ESQUERDA — bytes crus') + '  ' + 'DIREITA — linhas logicas')
  console.log('-'.repeat(W) + '  ' + '-'.repeat(W))

  const rows = Math.max(L.length, R.length)
  const isFill = i => L[i] !== undefined && L[i].trim() === ''
  const filling = L.filter(x => x.trim() === '').length
  let elided = false
  for (let i = 0; i < rows; i++) {
    // O miolo do filling e repeticao pura: colapsa uma vez e segue.
    if (i > 3 && i < rows - 3 && isFill(i)) {
      if (!elided) { console.log(pad(`   ⋮ (mais ${filling - 4} linhas de filling)`) + '  ' + pad('')); elided = true }
      continue
    }
    const l = L[i]
    const lm = l === undefined ? '' : (isFill(i) ? `·····FILLING·····` : vis(l))
    console.log(pad(lm) + '  ' + pad(R[i] === undefined ? '' : vis(R[i])))
  }

  console.log()
  console.log(`linhas cruas: ${L.length}  —  ${filling} delas sao filling`)
  console.log(`linhas logicas: ${R.length}  —  ${R.filter(x => x.trim() === '').length} de filling`)
  console.log(`o header diz ${info.lines}, e e ELE a autoridade sobre o fim da pagina`)
  console.log(`pagina ocupa: ${info.extent * PS} bytes  ·  multiplo de ${PS}: ${(info.extent * PS) % PS === 0}`)

  t.close()
} finally {
  rmSync(dir, { recursive: true, force: true })
}
