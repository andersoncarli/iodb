import { join } from 'path'
import { DB } from './db.js'

const wait = (ms = 10) => new Promise(r => setTimeout(r, ms))

// ── LEVEL 0: DIRS & NODES ───────────────────────────────────────────────────

test('L0: folder factory creation', async ({ check, withTempDir }) => {
  await withTempDir(async (dir) => {
    const db = DB({ path: dir })
    const sub = db.folder('assets')
    check((sub.path())?.includes?.('assets'))
    check(DB(join(dir, 'DB', 'assets')).exists)
  })
})

test('L0: universal system root (//)', async ({ check, withTempDir }) => {
  const sys = DB('//')
  check(sys.path(), '/')
  check(sys.type, 'node')
  // Should be able to see project root
  check(sys.has(process.cwd().slice(1)))
})

// ── LEVEL 1: RAW FILES & BLOBS ──────────────────────────────────────────────

test('L1: raw file storage (.txt)', async ({ check, withTempDir }) => {
  await withTempDir(async (dir) => {
    const db = DB({ path: dir })
    const f = db.file('note.txt')
    f.in("Hello World")
    f.flush()
    check(DB(join(dir, 'DB', 'note.txt'), 'file').get(), "Hello World")
  })
})

test('L1: blob storage', async ({ check, withTempDir }) => {
  await withTempDir(async (dir) => {
    const db = DB({ path: dir })
    const b = db.blob('data.bin')
    const buf = Buffer.from([1, 2, 3])
    b.in(buf)
    b.flush()
    check(DB(join(dir, 'DB', 'data.bin'), 'blob').get(), buf)
  })
})

// ── LEVEL 2: STRUCTURED DATA ────────────────────────────────────────────────

test('L2: YAML kv storage', async ({ check, withTempDir }) => {
  await withTempDir(async (dir) => {
    const db = DB({ path: dir })
    const kv = db.kv('config')
    kv.in({ port: 8080 })
    check(kv.get('port'), 8080)
    check(kv.port, 8080)
  })
})

test('L2: lines adapter', async ({ check, withTempDir }) => {
  await withTempDir(async (dir) => {
    const db = DB({ path: dir })
    const l = db.lines('log.txt')
    l.in(['start', 'stop'])
    check(l.get(0), 'start')
    check(l.get(1), 'stop')
  })
})

// ── LEVEL 3: REACTIVE STREAMS ───────────────────────────────────────────────

test('L3: stream reactive puts', async ({ check, withTempDir }) => {
  await withTempDir(async (dir) => {
    const db = DB({ path: dir })
    const stream = db.stream('events.dash')
    stream.in({ type: 'click', x: 10 })
    stream.in({ type: 'click', x: 20 })
    const recs = stream.records()
    check((recs.length) > 2) // Genesis + 2 clicks
  })
})

test('L3: reactive settlement (settle)', async ({ check, withTempDir }) => {
  await withTempDir(async (dir) => {
    const db = DB({ path: dir })
    const stream = db.stream('reactive.dash')
    const token = stream.put('command', { cmd: 'test' })

    // Async result injection
    setTimeout(() => {
      stream.put('result', { _prev: token.split('#')[1], status: 'ok' })
    }, 10)

    const res = await stream.settle(token)
    check(res.payload.status, 'ok')
  })
})

// ── LEVEL 4: SQL STORAGE ────────────────────────────────────────────────────

test('L4: SQLite basic operations', async ({ check, withTempDir }) => {
  await withTempDir(async (dir) => {
    const db = DB({ path: dir })
    const sql = db.sql('data.sqlite')

    sql.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
    sql.in({ users: { id: 1, name: 'Alice' } })

    const rows = sql.query("SELECT * FROM users")
    check((rows)?.length, 1)
    check(rows[0].name, 'Alice')

    // Test proxy getter access to tables
    check(sql.users?.length, 1)
  })
})
