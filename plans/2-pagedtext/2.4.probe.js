// Probe da 2.4 (contrato de indice plugavel) — a prova e que DUAS
// implementacoes distintas (text-pages e sqlite), atras da MESMA interface,
// concordam byte a byte em get/put/del/range sobre o mesmo corpus, e que uma
// terceira implementacao poderia se registrar sem tocar quem consome.

import { createIndex, knownIndexImpls, registerIndex } from '../../src/index-registry.js'
import '../../src/adapters/sqlite.js' // registra 'sqlite'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'idx24-'))

console.log('implementacoes conhecidas:', knownIndexImpls().join(', '))

// --- 1. corpus identico em ambas, concordancia de get/put/del/range -------
// REGRA DOS 3: a propriedade e CONCORDANCIA entre implementacoes, nao
// desempenho em volume — isso e o bench da 4.6, nao esta feature. N=2000
// bastava para provar, mas expos um custo real (text-pages.put() reescreve o
// arquivo inteiro por put — O(n) por escrita, O(n^2) no total) que nao e o
// que este probe existe para medir. N pequeno prova a mesma concordancia em
// milisegundos e nao mascara o custo: ele fica registrado como debito tecnico
// conhecido de TextPagesIndex, para o incremento do formato de pagina real.
const N = 100
const rows = Array.from({ length: N }, (_, i) => [String(i).padStart(6, '0'), i * 7])

const outcomes = {}
for (const name of ['text-pages', 'sqlite']) {
  const idx = createIndex(name, join(dir, `corpus.${name}`), {})
  idx.open()
  for (const [k, v] of rows) idx.put(k, v)
  idx.del('000001') // remove uma, prova que del() concorda tambem
  outcomes[name] = {
    gets: rows.map(([k]) => idx.get(k)),
    rangeCount: [...idx.range('000010', '000020')].length,
    deletedIsGone: idx.get('000001') === undefined
  }
  idx.close()
}
console.log('gets identicos:', JSON.stringify(outcomes['text-pages'].gets) === JSON.stringify(outcomes['sqlite'].gets))
console.log('range identico:', outcomes['text-pages'].rangeCount === outcomes['sqlite'].rangeCount, outcomes['text-pages'].rangeCount)
console.log('del concorda:', outcomes['text-pages'].deletedIsGone === outcomes['sqlite'].deletedIsGone)

// --- 2. terceira implementacao registrada sem tocar io-engine.js ----------
registerIndex('mem-fake', () => {
  const m = new Map()
  return {
    open() {}, close() {},
    get: k => m.get(k), put: (k, v) => m.set(k, v), del: k => m.delete(k),
    * range(lo, hi) { for (const [k, v] of m) if (k >= lo && k <= hi) yield [k, v] },
    rebuild(from, recs) { m.clear(); for (const r of recs) m.set(r.key, r.offset) }
  }
})
const fake = createIndex('mem-fake', ':memory:', {})
fake.open()
fake.put('x', 1)
console.log('terceira implementacao plugavel:', fake.get('x') === 1)
console.log('registro cresceu sem editar consumidores:', knownIndexImpls().includes('mem-fake'))

// --- 3. rebuild reconstroi a partir do .dash (simulado) --------------------
const idx3 = createIndex('text-pages', join(dir, 'rebuild.idx'), {})
idx3.open()
idx3.put('stale', 999)
idx3.rebuild(0, [{ key: 'a', offset: 1 }, { key: 'b', offset: 2 }])
console.log('rebuild descarta estado antigo:', idx3.get('stale') === undefined)
console.log('rebuild aplica o novo:', idx3.get('a') === 1 && idx3.get('b') === 2)
idx3.close()
