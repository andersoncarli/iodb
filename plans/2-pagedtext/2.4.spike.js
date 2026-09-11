// Spike de decisao da 2.4: B-tree propria em paginas de texto vs bun:sqlite
// como motor de indice chave->offset. Mede open() (fast-open) e lookup
// pontual/por range nas duas abordagens, no mesmo corpus.
//
// "B-tree propria" ainda nao existe — o baseline dela e o que o iodb faz HOJE
// para resolver uma chave sem indice real: replay do .dash inteiro (syncFrom
// em io-engine.js) populando um Map em memoria. E o custo que a 2.4 promete
// eliminar, entao e o numero certo para comparar contra sqlite.
import { Database } from 'bun:sqlite'
import { writeFileSync, unlinkSync, existsSync } from 'fs'

const N = Number(process.argv[2] || 20000)
const RANGE_FRAC = 0.01 // 1% do espaco de chaves, para o teste de range

function nowMs() { return Number(process.hrtime.bigint()) / 1e6 }

function makeRows(n) {
  const rows = []
  for (let i = 0; i < n; i++) {
    const id = String(i).padStart(8, '0')
    rows.push({ id, value: `payload-${i}`, n: i })
  }
  return rows
}

// ---- baseline: replay de texto para um Map (o que io-engine.js faz hoje) ----
function buildDashFile(rows, path) {
  const lines = rows.map(r => JSON.stringify({ [r.id]: { value: r.value, n: r.n } }))
  writeFileSync(path, lines.join('\n') + '\n')
}

function scanOpen(path) {
  const t0 = nowMs()
  const text = require('fs').readFileSync(path, 'utf8')
  const map = new Map()
  for (const line of text.split('\n')) {
    if (!line) continue
    const rec = JSON.parse(line)
    const key = Object.keys(rec)[0]
    map.set(key, rec[key])
  }
  const openMs = nowMs() - t0
  return { map, openMs }
}

function scanLookup(map, key) {
  const t0 = nowMs()
  const v = map.get(key)
  return { v, ms: nowMs() - t0 }
}

function scanRange(map, lo, hi) {
  const t0 = nowMs()
  const out = []
  for (const [k, v] of map) if (k >= lo && k <= hi) out.push(v)
  return { out, ms: nowMs() - t0 }
}

// ---- sqlite: bun:sqlite com PRIMARY KEY id ----
function sqliteBuild(rows, path) {
  if (existsSync(path)) unlinkSync(path)
  const db = new Database(path, { create: true })
  db.run('CREATE TABLE kv (id TEXT PRIMARY KEY, value TEXT, n INTEGER)')
  db.run('BEGIN')
  const stmt = db.prepare('INSERT INTO kv (id, value, n) VALUES (?, ?, ?)')
  for (const r of rows) stmt.run(r.id, r.value, r.n)
  db.run('COMMIT')
  db.close()
}

function sqliteOpen(path) {
  const t0 = nowMs()
  const db = new Database(path, { readonly: true })
  // fast-open real: nao le as linhas, so abre o arquivo e prepara
  db.query('SELECT 1').get()
  const openMs = nowMs() - t0
  return { db, openMs }
}

function sqliteLookup(db, key) {
  const t0 = nowMs()
  const v = db.query('SELECT value, n FROM kv WHERE id = ?').get(key)
  return { v, ms: nowMs() - t0 }
}

function sqliteRange(db, lo, hi) {
  const t0 = nowMs()
  const out = db.query('SELECT value, n FROM kv WHERE id >= ? AND id <= ? ORDER BY id').all(lo, hi)
  return { out, ms: nowMs() - t0 }
}

const rows = makeRows(N)
const dashPath = '/tmp/2.4-spike.dash'
const sqlitePath = '/tmp/2.4-spike.sqlite'

buildDashFile(rows, dashPath)
sqliteBuild(rows, sqlitePath)

const midKey = rows[Math.floor(N / 2)].id
const loKey = rows[Math.floor(N * 0.4)].id
const hiKey = rows[Math.floor(N * 0.4 + N * RANGE_FRAC)].id

// scan/replay baseline
const { map, openMs: scanOpenMs } = scanOpen(dashPath)
const scanLk = scanLookup(map, midKey)
const scanRg = scanRange(map, loKey, hiKey)

// sqlite
const { db, openMs: sqliteOpenMs } = sqliteOpen(sqlitePath)
const sqliteLk = sqliteLookup(db, midKey)
const sqliteRg = sqliteRange(db, loKey, hiKey)
db.close()

console.log(`N=${N} rows`)
console.log('')
console.log('| operacao          | scan/replay (hoje) | bun:sqlite |')
console.log('|--------------------|---------------------|------------|')
console.log(`| open()             | ${scanOpenMs.toFixed(3)}ms            | ${sqliteOpenMs.toFixed(3)}ms    |`)
console.log(`| lookup pontual     | ${scanLk.ms.toFixed(4)}ms           | ${sqliteLk.ms.toFixed(4)}ms   |`)
console.log(`| range (${(RANGE_FRAC * 100).toFixed(0)}% do espaco) | ${scanRg.ms.toFixed(3)}ms  (${scanRg.out.length} linhas) | ${sqliteRg.ms.toFixed(3)}ms (${sqliteRg.out.length} linhas) |`)
console.log('')
console.log(`runtime: bun:sqlite requer Bun; scan/replay roda em Node e Bun (node:fs puro)`)
