// Mede o custo de flushPages() apos a feature 1.6 (indice de chaves
// incremental): adicionar 1 entry a um store de N deveria ser proporcional ao
// tanto que desloca (o sufixo a partir da chave), nao ao tamanho total do
// store. Compara "insert no fim" (melhor caso: sufixo pequeno) contra "insert
// no inicio" (pior caso esperado: sufixo = store inteiro, sem regressao).
//
// Uso: bun src/paged-projection.bench.js

import { PagedProjection } from './paged-projection.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const Ns = [400, 800, 1600, 3200]

function seeded(n) {
  const dir = mkdtempSync(join(tmpdir(), 'iodb-flush-bench-'))
  const file = join(dir, 'store.dash')
  const proj = PagedProjection(file, { layout: 'keyed' })
  for (let i = 0; i < n; i++) proj[`k${String(i).padStart(7, '0')}`] = { i }
  proj.__flushPages()
  return { dir, proj }
}

function timeInsert(proj, key) {
  const t0 = performance.now()
  proj[key] = { added: true }
  proj.__flushPages()
  return performance.now() - t0
}

console.log('| N (antes do insert) | add no FIM (ms) | add no INICIO (ms, pior caso) |')
console.log('|---|---|---|')
for (const n of Ns) {
  const { dir, proj } = seeded(n)
  const end = timeInsert(proj, `k${String(n).padStart(7, '0')}z`) // maior que tudo
  const start = timeInsert(proj, '0-before-everything')
  console.log(`| ${n} | ${end.toFixed(2)} | ${start.toFixed(2)} |`)
  rmSync(dir, { recursive: true, force: true })
}
