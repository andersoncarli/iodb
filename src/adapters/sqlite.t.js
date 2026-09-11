import { SqliteCollection } from './sqlite.js'
import IO, { merge } from '../io-engine.js'
import { join } from 'path'

test('SQLite Adapter: constructs', async ({ check }) => {
  await withTempDir(async (tmp) => {
    const db = SqliteCollection(join(tmp, 't.db'))
    check(is.defined(db))
  })
})

test('SQLite Adapter: keyed surface — put upserts, remove deletes, all lists', async ({ check }) => {
  await withTempDir(async (tmp) => {
    const db = SqliteCollection(join(tmp, 'k.db'), { table: 'entries' })
    db.open()

    check(db.all(), [])                                   // empty before first write

    db.put('1:10', { name: 'a', size: 100 })
    db.put('1:11', { name: 'b', size: 200 })
    check(db.all().length, 2)

    db.put('1:10', { name: 'a', size: 999 })              // upsert, not a second row
    check(db.all().length, 2)
    check(db.all().find(r => r.id === '1:10').size, 999)

    db.remove('1:11')
    check(db.all().length, 1)
    check(db.all()[0].id, '1:10')

    db.flush()                                            // no-op, must not throw
    check(db.all().length, 1)
  })
})

test('SQLite Adapter: keyed calls without { table } throw', async ({ check, checkException }) => {
  await withTempDir(async (tmp) => {
    const db = SqliteCollection(join(tmp, 'nt.db'))
    db.open()
    checkException(() => db.put('1', { x: 1 }))
    checkException(() => db.all())
  })
})

test('SQLite Adapter: raw INSERT passthrough still works', async ({ check }) => {
  await withTempDir(async (tmp) => {
    const db = SqliteCollection(join(tmp, 'raw.db'))
    db.open()
    db.run('CREATE TABLE people (name TEXT, age INTEGER)')
    db.in({ people: { name: 'alice', age: 30 } })
    db.in({ people: { name: 'bob', age: 25 } })
    check(db.query('SELECT count(*) c FROM people')[0].c, 2)
    check(db.get('people').length, 2)
  })
})

// The parity proof: the SAME keyed sequence against IO(merge) and against
// SqliteCollection leaves all() equal — including the effect of remove, which
// is a merge tombstone (`null` -> delete key) on one side and a DELETE on the
// other.
test('SQLite Adapter: keyed surface is observationally equal to IO(merge)', async ({ check }) => {
  await withTempDir(async (tmp) => {
    const io = IO(join(tmp, 'proj'), { reduce: merge, initial: {} })
    io.open()
    const sq = SqliteCollection(join(tmp, 'p.db'), { table: 'entries' })
    sq.open()

    const seq = [
      ['put', '1:10', { id: '1:10', name: 'a', kind: 'file' }],
      ['put', '1:11', { id: '1:11', name: 'b', kind: 'dir' }],
      ['put', '1:10', { id: '1:10', name: 'a', kind: 'file', size: 42 }],  // upsert
      ['remove', '1:11'],
    ]

    for (const [op, id, row] of seq) {
      if (op === 'put') { io.in({ [id]: row }); sq.put(id, row) }
      else { io.in({ [id]: null }); sq.remove(id) }
    }
    io.flush(); sq.flush()

    const norm = rows =>
      rows
        .map(r => ({ id: r.id, name: r.name, kind: r.kind, size: r.size ?? null }))
        .sort((x, y) => x.id.localeCompare(y.id))

    // io.get('#1') carries _entity/_type/_projection metadata keys alongside
    // the rows — the same filter fswatch's MetadataStore applies.
    const ioRows = Object.entries(io.get('#1'))
      .filter(([k, v]) => /^\d+:\d+$/.test(k) && v && typeof v === 'object')
      .map(([, v]) => v)
    const fromIo = norm(ioRows)
    const fromSq = norm(sq.all())

    check(fromIo.length, 1)                 // b was removed on both sides
    check(fromSq.length, 1)
    check(fromIo, fromSq)                   // deep-equal: same row for 1:10
    check(fromSq[0].size, 42)              // upsert took on both sides

    io.close()
    sq.close()
  })
})
