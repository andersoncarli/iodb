// Probe — feature 7.1: SqliteCollection ganha a superficie chaveada.
//
// Roda a MESMA sequencia keyed contra IO(merge) e contra SqliteCollection e
// imprime, lado a lado, o que cada `all()` devolve. Imprime tambem que o
// passthrough de SQL cru continua vivo. O eval afirma sobre esta saida.

import IO, { merge } from '../../src/io-engine.js'
import { SqliteCollection } from '../../src/adapters/sqlite.js'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const d = mkdtempSync(join(tmpdir(), 'probe71-'))
try {
  const io = IO(join(d, 'proj'), { reduce: merge, initial: {} })
  io.open()
  const sq = SqliteCollection(join(d, 'k.db'), { table: 'entries' })
  sq.open()

  // put / put / put-upsert (coluna nova aparece depois) / remove
  const seq = [
    ['put', '1:10', { id: '1:10', name: 'a', kind: 'file' }],
    ['put', '1:11', { id: '1:11', name: 'b', kind: 'dir' }],
    ['put', '1:10', { id: '1:10', name: 'a', kind: 'file', size: 42 }],
    ['remove', '1:11'],
  ]
  for (const [op, id, row] of seq) {
    if (op === 'put') { io.in({ [id]: row }); sq.put(id, row) }
    else { io.in({ [id]: null }); sq.remove(id) }
  }
  io.flush(); sq.flush()

  const norm = rows => rows
    .map(r => ({ id: r.id, name: r.name, kind: r.kind, size: r.size ?? null }))
    .sort((x, y) => x.id.localeCompare(y.id))

  const ioRows = norm(Object.entries(io.get('#1'))
    .filter(([k, v]) => /^\d+:\d+$/.test(k) && v && typeof v === 'object')
    .map(([, v]) => v))
  const sqRows = norm(sq.all())

  console.log('iodb all:', JSON.stringify(ioRows))
  console.log('sqlite all:', JSON.stringify(sqRows))
  console.log('paridade:', JSON.stringify(ioRows) === JSON.stringify(sqRows) ? 'IGUAL' : 'DIVERGE')
  console.log('linhas iodb:', ioRows.length)
  console.log('linhas sqlite:', sqRows.length)
  console.log('remove apagou b: iodb=' + !ioRows.some(r => r.id === '1:11') +
              ' sqlite=' + !sqRows.some(r => r.id === '1:11'))
  console.log('upsert pegou size=42: iodb=' + (ioRows[0].size === 42) +
              ' sqlite=' + (sqRows[0].size === 42))

  io.close(); sq.close()

  // Passthrough de SQL cru — sem { table }, o `in({ tabela: linha })` de INSERT
  // continua sendo o que era.
  const raw = SqliteCollection(join(d, 'raw.db'))
  raw.open()
  raw.run('CREATE TABLE people (name TEXT, age INTEGER)')
  raw.in({ people: { name: 'alice', age: 30 } })
  raw.in({ people: { name: 'bob', age: 25 } })
  console.log('passthrough INSERT cru:', raw.query('SELECT count(*) c FROM people')[0].c === 2 ? 'ok' : 'QUEBROU')
  console.log('get(tabela) devolve linhas:', raw.get('people').length === 2 ? 'ok' : 'QUEBROU')
  raw.close()

  // flush() e no-op — nao lanca, nao muda nada.
  const f = SqliteCollection(join(d, 'f.db'), { table: 't' })
  f.open()
  f.put('x', { id: 'x', v: 1 })
  const before = f.all().length
  f.flush()
  console.log('flush no-op:', f.all().length === before ? 'ok' : 'MUDOU')
  f.close()

  // Sem { table }, as chamadas keyed lancam — a porta so abre quando declarada.
  const nt = SqliteCollection(join(d, 'nt.db'))
  nt.open()
  let threw = false
  try { nt.put('1', { x: 1 }) } catch { threw = true }
  console.log('put sem table lanca:', threw ? 'ok' : 'NAO LANCOU')
  nt.close()
} finally {
  rmSync(d, { recursive: true, force: true })
}
