import { LazyTree } from '../lazytree.js'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

test('lazytree: totals aggregates files/dirs/bytes lazily, via stat()', async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    await mkdir(path.join(dir, 'sub1'))
    await mkdir(path.join(dir, 'sub2'))
    await writeFile(path.join(dir, 'a.txt'), '12345')
    await writeFile(path.join(dir, 'sub1', 'b.txt'), '1234567890')
    await writeFile(path.join(dir, 'sub2', 'c.txt'), '123')

    const tree = LazyTree(dir)
    const t = await tree.root.totals()
    check(t, { files: 3, dirs: 3, bytes: 18 })

    const children = await tree.root.children()
    const sub1 = children.find(c => c.name === 'sub1')
    check(await sub1.totals(), { files: 1, dirs: 1, bytes: 10 })
  })
})
