import { JsonlCollection } from './15-jsonl.js'
import { join } from 'path'
import { rmSync, mkdirSync, existsSync } from 'fs'

test('JSONL Adapter: Basic operations', async () => {
  await withTempDir(async (tmp) => {
    const fp = join(tmp, 'test.jsonl')
    const db = JsonlCollection(fp)

    // 1. Put and check state
    db.in({ hello: 'world' }).flush()
    expect(db.get()).toEqual({ hello: 'world' })

    // 2. Patch incremental
    db.in({ user: { name: 'alice' } }).flush()
    expect(db.get().user.name).toBe('alice')

    // 3. Deep Merge
    db.in({ user: { age: 30 } }).flush()
    expect(db.get().user.name).toBe('alice')
    expect(db.get().user.age).toBe(30)
    
    // 4. Persistence Reload
    const db2 = JsonlCollection(fp)
    expect(db2.get().hello).toBe('world')
    expect(db2.get().user.age).toBe(30)
  })
})

test('JSONL Adapter: Buffer Extraction (Fast Path)', async () => {
    await withTempDir(async (tmp) => {
        const { jsonlFmt } = await import('./15-jsonl.js')
        const fmt = jsonlFmt('extracted.jsonl')
        const buf = Buffer.from('{"item:1":{"val":100}}\n{"item:2":{"val":200}}\n')
        
        const val1 = fmt.extractFromBuffer(buf, 'item:1')
        const val2 = fmt.extractFromBuffer(buf, 'item:2')
        const val3 = fmt.extractFromBuffer(buf, 'item:3')
        
        expect(val1.val).toBe(100)
        expect(val2.val).toBe(200)
        expect(val3).toBe(null)
    })
})
