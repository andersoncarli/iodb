import { JsonlCollection } from './15-jsonl.js'
import { join } from 'path'
import { rmSync, mkdirSync, existsSync } from 'fs'

test('JSONL Adapter: Basic operations',  async ({check}) => {
  await withTempDir(async (tmp) => {
    const fp = join(tmp, 'test.jsonl')
    const db = JsonlCollection(fp)

    // 1. Put and check state
    db.in({ hello: 'world' }).flush()
    check(db.get(), { hello: 'world' })

    // 2. Patch incremental
    db.in({ user: { name: 'alice' } }).flush()
    check(db.get().user.name, 'alice')

    // 3. Deep Merge
    db.in({ user: { age: 30 } }).flush()
    check(db.get().user.name, 'alice')
    check(db.get().user.age, 30)

    // 4. Persistence Reload
    const db2 = JsonlCollection(fp)
    check(db2.get().hello, 'world')
    check(db2.get().user.age, 30)
  })
})

test('JSONL Adapter: Buffer Extraction (Fast Path)',  async ({check}) => {
    await withTempDir(async (tmp) => {
        const { jsonlFmt } = await import('./15-jsonl.js')
        const fmt = jsonlFmt('extracted.jsonl')
        const buf = Buffer.from('{"item:1":{"val":100}}\n{"item:2":{"val":200}}\n')

        const val1 = fmt.extractFromBuffer(buf, 'item:1')
        const val2 = fmt.extractFromBuffer(buf, 'item:2')
        const val3 = fmt.extractFromBuffer(buf, 'item:3')

        check(val1.val, 100)
        check(val2.val, 200)
        check(val3, null)
    })
})
