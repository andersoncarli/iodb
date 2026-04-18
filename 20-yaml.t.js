import { YamlCollection } from './20-yaml.js'
import { join } from 'path'

test('YAML Adapter: Basic operations', async () => {
  await withTempDir(async (tmp) => {
    const fp = join(tmp, 'test.yaml')
    const db = YamlCollection(fp)

    // 1. Initial State
    expect(db.get()).toEqual({})

    // 2. Put and check
    db.in({ project: 'Helix', version: '2.0' }).flush()
    expect(db.get().project).toBe('Helix')

    // 3. Multi-path merge
    db.in({ 'meta/author': 'kk' }).flush()
    expect(db.get().meta.author).toBe('kk')
    expect(db.get().project).toBe('Helix')

    // 4. Persistence Reload
    const db2 = YamlCollection(fp)
    expect(db2.get().project).toBe('Helix')
    expect(db2.get().meta.author).toBe('kk')
    
    // 5. Empty File handling
    const fp2 = join(tmp, 'empty.yaml')
    const db3 = YamlCollection(fp2)
    expect(db3.get()).toEqual({})
  })
})
