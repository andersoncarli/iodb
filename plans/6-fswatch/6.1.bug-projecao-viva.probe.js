// ACHADO DA 6.1, e ele NAO e do fswatch: e do engine.
//
// Na projecao PAGINADA (pageSize > 0), uma leitura VIVA por chave devolve undefined,
// embora Object.keys liste a chave. Reabrir o store le tudo certo. Ou seja: o dado
// esta durável, o LOG esta certo, e so a visao em memoria do processo que escreveu
// nao enxerga o que ele mesmo acabou de gravar.
//
// Nao e um bug de escrita bufferizada: acontece com o flush padrao tambem.
// Nao e sobre o formato da chave nem sobre valor objeto: acontece com escalar.
// A projecao MONOLITICA (pageSize: 0) nao tem o problema.
//
// Custo para o consumidor: o fswatch mantem um espelho em memoria do baseline
// (MetadataStore.mirror) porque nao pode ler de volta o que gravou. O espelho
// deve morrer quando o engine servir leitura viva.
//
// Onde consertar: frente 2 (2.5 projecao paginada 4K) — nao nesta feature.
import IO, { merge } from '../../src/io-engine.js'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const mk = () => join(mkdtempSync(join(os.tmpdir(), 'io-')), 'store')

for (const pageSize of [0, 4096]) {
  const base = mk()
  const io = IO(base, { reduce: merge, initial: {}, pageSize })
  io.open()
  io.in({ escalar: 42 })
  io.in({ objeto: { a: 1 } })

  const vivo = io.get('#1')
  const listou = Object.keys(vivo).includes('escalar')
  const leu = vivo.escalar
  io.close()

  const re = IO(base, { reduce: merge, initial: {}, pageSize })
  re.open()
  const depois = re.get('#1').escalar

  console.log(
    `pageSize=${String(pageSize).padEnd(5)} ` +
    `Object.keys lista=${listou} | leitura viva=${JSON.stringify(leu)} | apos reopen=${JSON.stringify(depois)}`
  )
}
