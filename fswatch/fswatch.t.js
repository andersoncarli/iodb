import { FSWatch, MetadataStore, SqliteStore } from './fswatch.js'
import { mkdir, writeFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'

const wait = ms => new Promise(r => setTimeout(r, ms))
const clusters = dir => ({
  SOURCE: { targets: [dir], include: ['**/*.ts'] },
  TESTS:  { targets: [dir], include: ['**/*.test.ts'] }
})
// The store lives inside the tree it watches, so it shows up in a scan of it.
const real = fs => fs.entries().filter(e => e.name !== '.fswatch')

test('fswatch: scan persists the tree', async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    await mkdir(path.join(dir, 'src'))
    await writeFile(path.join(dir, 'src', 'a.ts'), 'x')
    const fs = await FSWatch(clusters(dir))
    await fs.scan()
    check(real(fs).length, 3)          // root + src + a.ts
    check(fs.stats().entries, 4)       // + the .fswatch dir, counted and known
    fs.close()
  })
})

test('fswatch: overlapping clusters both receive the event', async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    const fs = await FSWatch(clusters(dir))
    const seen = []
    fs.SOURCE.on(e => seen.push(['SOURCE', e.type]))
    fs.TESTS.on(e => seen.push(['TESTS', e.type]))
    await fs.scan()                                   // baseline first: empty tree
    await writeFile(path.join(dir, 'a.test.ts'), 'x') // then the change
    await fs.reconcile()                              // which reconcile must see
    check(seen.some(([c]) => c === 'SOURCE'), true)
    check(seen.some(([c]) => c === 'TESTS'), true)
    fs.close()
  })
})

test('fswatch: rename keeps the inode identity', async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    await writeFile(path.join(dir, 'a.ts'), 'x')
    const fs = await FSWatch(clusters(dir))
    await fs.scan()
    const before = real(fs).find(e => e.name === 'a.ts').id
    const moves = []
    fs.SOURCE.on(e => { if (e.type === 'move') moves.push(e) })
    await rename(path.join(dir, 'a.ts'), path.join(dir, 'b.ts'))
    await fs.reconcile()
    check(moves.length > 0, true)
    check(moves[0].id, before)     // identity is (dev,ino), not the path
    fs.close()
  })
})

// merge is SHALLOW and deletes nothing, where SQLite dropped the row from the other
// table before upserting. Every field must be rewritten on every put, or `size`
// outlives the file. Nothing covered this under SQLite.
test('fswatch: a dir over a file leaves no residual size', async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    const st = MetadataStore(path.join(dir, 'store'))
    const at = { dev: 9, ino: 9, mode: 0, mtime: 0, ctime: 0 }
    st.put({ id: '9:9', name: 'x', kind: 'file', size: 123, ...at })
    st.put({ id: '9:9', name: 'x', kind: 'dir', ...at })
    const e = st.all().find(x => x.id === '9:9')
    st.close()
    check(e.kind, 'dir')
    check(e.size, null)
  })
})

test('fswatch: the store survives a reopen', async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    const base = path.join(dir, 'store')
    let st = MetadataStore(base)
    st.put({ id: '9:9', name: 'a.ts', kind: 'file', dev: 9, ino: 9, mode: 0, mtime: 0, ctime: 0, size: 1 })
    st.close()
    st = MetadataStore(base)
    check(st.all().length, 1)
    check(st.all()[0].name, 'a.ts')
    st.close()
  })
})

// The backend is a choice, not a rewrite: both answer put/remove/flush/all/close.
test('fswatch: the sqlite backend answers the same interface', async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    for (const make of [MetadataStore, SqliteStore]) {
      const st = make(path.join(dir, `s-${make.name}`))
      st.put({ id: '9:9', name: 'x', kind: 'file', dev: 9, ino: 9, mode: 0, mtime: 0, ctime: 0, size: 5 })
      check(st.all().length, 1)
      st.remove('9:9')
      check(st.all().length, 0)
      st.flush()
      st.close()
    }
  })
})
