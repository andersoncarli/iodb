import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const run = (args, cwd) => {
  const p = Bun.spawnSync(['bun', path.join(import.meta.dir, 'cli.js'), ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  return { out: p.stdout.toString(), err: p.stderr.toString(), code: p.exitCode }
}

test('fswatch cli: scan --totals reports files/dirs/bytes per top-level dir', async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    await mkdir(path.join(dir, 'sub'))
    await writeFile(path.join(dir, 'a.txt'), '12345')
    await writeFile(path.join(dir, 'sub', 'b.txt'), '1234567890')

    const { out } = run(['scan', dir, '--totals'])
    check(out.includes('2 files, 2 dirs'), true)
    check(out.includes('sub/  1 files, 1 dirs'), true)
  })
})

test('fswatch cli: find matches by name across the tree', async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    await mkdir(path.join(dir, 'sub'))
    await writeFile(path.join(dir, 'sub', 'needle.txt'), 'x')
    await writeFile(path.join(dir, 'other.txt'), 'x')

    const { out } = run(['find', 'needle', dir])
    check(out.includes('needle.txt'), true)
    check(out.includes('other.txt'), false)
  })
})

