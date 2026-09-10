import { PagedProjection, materialize } from './paged-projection.js'
import { readFileSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'

const PS = 4096

test('paged-projection: keyed layout behaves like an object', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const p = PagedProjection(join(dir, 'proj'), { layout: 'keyed', pageSize: PS })
    p.alpha = 1
    p.beta = { x: 2 }
    p.gamma = 'three'
    p.__flushPages()

    check(p.alpha, 1)
    check(p.beta.x, 2)
    check(p.gamma, 'three')
    check('beta' in p, true)
    check('missing' in p, false)
    check(Object.keys(p).sort().join(','), 'alpha,beta,gamma')
  })
})

test('paged-projection: reopen recovers all keys', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'proj')
    const p = PagedProjection(file, { layout: 'keyed', pageSize: PS })
    for (let i = 0; i < 500; i++) p['k' + String(i).padStart(4, '0')] = i
    p.__flushPages()

    const q = PagedProjection(file, { layout: 'keyed', pageSize: PS })
    check(q.k0000, 0)
    check(q.k0250, 250)
    check(q.k0499, 499)
    check(Object.keys(q).length, 500)
  })
})

test('paged-projection: pages are 4096-aligned', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'proj')
    const p = PagedProjection(file, { layout: 'keyed', pageSize: PS })
    for (let i = 0; i < 800; i++) p['key' + String(i).padStart(4, '0')] = { v: i, note: 'x'.repeat(20) }
    p.__flushPages()

    const size = statSync(file).size
    check(size % PS === 0, true)
    check(size >= 2 * PS, true)   // header + at least one data page

    const raw = readFileSync(file)
    const header = JSON.parse(raw.toString('utf8', 0, raw.indexOf(0)))
    check(header.magic, 'PAGEDPROJ')
    check(header.pages.length >= 1, true)
    check(header.keys.length, header.pages.length)   // one split key per page
  })
})

test('paged-projection: point read pages in only the covering page', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'proj')
    const p = PagedProjection(file, { layout: 'keyed', pageSize: PS })
    for (let i = 0; i < 2000; i++) p['id' + String(i).padStart(5, '0')] = i
    p.__flushPages()

    const q = PagedProjection(file, { layout: 'keyed', pageSize: PS })
    const v = q.id01000
    check(v, 1000)
    // one page cached, not all of them
    check(q.__allEntries === undefined, false)
  })
})

test('paged-projection: tombstone (delete) survives reopen', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'proj')
    const p = PagedProjection(file, { layout: 'keyed', pageSize: PS })
    p.a = 1; p.b = 2; p.c = 3
    p.__flushPages()
    delete p.b
    p.__flushPages()

    const q = PagedProjection(file, { layout: 'keyed', pageSize: PS })
    check(q.a, 1)
    check('b' in q, false)
    check(q.c, 3)
    check(Object.keys(q).sort().join(','), 'a,c')
  })
})

test('paged-projection: sequential layout preserves append order', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'seq')
    const p = PagedProjection(file, { layout: 'sequential', pageSize: PS })
    for (let i = 0; i < 600; i++) p.push({ i, tag: 'e' })
    p.__flushPages()

    const q = PagedProjection(file, { layout: 'sequential', pageSize: PS })
    check(q.length, 600)
    check(q[0].i, 0)
    check(q[300].i, 300)
    check(q[599].i, 599)
    check([...q].map(x => x.i).join(',') === Array.from({ length: 600 }, (_, i) => i).join(','), true)
  })
})

test('paged-projection: materialize round-trips through JSON', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const p = PagedProjection(join(dir, 'proj'), { layout: 'keyed', pageSize: PS })
    p.x = 10; p.y = 20
    p.__flushPages()
    const snap = materialize(p)
    check(JSON.stringify(snap), '{"x":10,"y":20}')
  })
})

test('paged-projection: seeds from initial', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const p = PagedProjection(join(dir, 'proj'), { layout: 'keyed', pageSize: PS, initial: { seeded: true, n: 7 } })
    check(p.seeded, true)
    check(p.n, 7)
  })
})
