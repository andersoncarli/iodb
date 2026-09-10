import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir, writeFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { FSWatch } from '../fswatch.js'

const temp = () => path.join(os.tmpdir(), `fswatch-${crypto.randomUUID()}`)
const wait = ms => new Promise(r => setTimeout(r, ms))

describe('FSWatch', () => {
  let dir, fs
  beforeEach(async () => {
    dir = temp(); await mkdir(dir, {recursive:true})
    fs = await FSWatch({
      SOURCE:{targets:[dir],include:['**/*.ts']},
      TESTS:{targets:[dir],include:['**/*.test.ts']},
      IGNORE:{targets:[dir],include:['**/node_modules/**']}
    })
  })
  afterEach(async () => { fs.close(); await rm(dir,{recursive:true,force:true}) })

  test('scan persists nodes and leaves', async () => {
    await mkdir(path.join(dir,'src'))
    await writeFile(path.join(dir,'src','a.ts'),'x')
    await fs.scan()
    expect(fs.stats().entries).toBe(3)
  })

  test('overlapping clusters receive the same event', async () => {
    const got=[]
    fs.SOURCE.on(e=>got.push('source'))
    fs.TESTS.on(e=>got.push('tests'))
    await fs.watch()
    await writeFile(path.join(dir,'a.test.ts'),'x')
    await wait(100)
    expect(got).toContain('source')
    expect(got).toContain('tests')
  })

  test('new directories become watched', async () => {
    const got=[]
    fs.SOURCE.on(e=>got.push(e))
    await fs.watch()
    await mkdir(path.join(dir,'src'))
    await wait(100)
    await writeFile(path.join(dir,'src','a.ts'),'x')
    await wait(100)
    expect(got.some(e=>e.path?.endsWith('/src/a.ts'))).toBe(true)
  })

  test('reconcile detects create and delete', async () => {
    await fs.scan()
    await writeFile(path.join(dir,'a.ts'),'x')
    const got=[]; fs.SOURCE.on(e=>got.push(e))
    await fs.reconcile([dir])
    expect(got.some(e=>e.type==='create')).toBe(true)
    await rm(path.join(dir,'a.ts'))
    await fs.reconcile([dir])
    expect(got.some(e=>e.type==='delete')).toBe(true)
  })

  test('rename preserves inode identity during reconciliation', async () => {
    await writeFile(path.join(dir,'a.ts'),'x')
    await fs.scan()
    const before = [...fs.db.query('SELECT id FROM leaves WHERE name=?').all('a.ts')][0].id
    await rename(path.join(dir,'a.ts'),path.join(dir,'b.ts'))
    const got=[]; fs.SOURCE.on(e=>got.push(e))
    await fs.reconcile([dir])
    expect(got.some(e=>e.type==='move' && e.id===before)).toBe(true)
  })
})
