/**
 * Sonda da feature 2.0 — a prova em BYTES de que a escrita e O(paginas sujas).
 *
 * Precedente: plans/4-concorrencia/4.3.probe.js. Uma sonda mede; ela nao asserta
 * nem move degrau. O criterio de aceitacao da 2.0 e um numero, e um grep nao
 * consegue produzi-lo: `flush()` sempre pareceu escrever pouco no codigo-fonte.
 * So contando bytes escritos da para separar "escreve a pagina suja" de
 * "reescreve o arquivo inteiro".
 */
import { PagedText } from '../../pagedtext/pagedtext.js'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'pagedtext-2.0-'))
try {
  const file = join(dir, 'big.txt')
  const lines = []
  for (let i = 0; i < 1000; i++)
    for (let j = 0; j < 50; j++) lines.push(`page ${i} line ${j} ` + 'x'.repeat(60))

  const t = PagedText({ path: file, pageSize: 4096 })
  t._store.replaceAll(lines)
  t._store.flush()

  const pages = t._store.pageCount()
  const size = statSync(file).size
  console.log(`store: ${pages} data pages, ${size} bytes on disk`)

  // Uma unica linha apendada na cauda.
  t.push('one more line appended at the very end')
  const w = t._store.lastWrite
  console.log(`pages written: ${w.pages}`)
  console.log(`bytes written: ${w.bytes}`)
  console.log(`full rewrite would be: ${size} bytes`)
  console.log(`ratio: ${(w.bytes / size * 100).toFixed(3)}% do arquivo`)

  // Uma linha no MEIO — o caso que nao pode cascatear.
  t[500] = 'overwritten in the middle'
  const m = t._store.lastWrite
  console.log(`mid-file overwrite — pages written: ${m.pages}, bytes: ${m.bytes}`)

  t.close()
} finally {
  rmSync(dir, { recursive: true, force: true })
}
