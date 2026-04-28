import { YamlCollection } from './20-yaml.js'
import { join } from 'path'

test('YAML Adapter: Basic operations',  async ({check}) => {
  await withTempDir(async (tmp) => {
    const fp = join(tmp, 'test.yaml')
    const db = YamlCollection(fp)

    // 1. Initial State
    check(db.get(), {})

    // 2. Put and check
    db.in({ project: 'Helix', version: '2.0' }).flush()
    check(db.get().project, 'Helix')

    // 3. Multi-path merge
    db.in({ 'meta/author': 'kk' }).flush()
    check(db.get().meta.author, 'kk')
    check(db.get().project, 'Helix')

    // 4. Persistence Reload
    const db2 = YamlCollection(fp)
    check(db2.get().project, 'Helix')
    check(db2.get().meta.author, 'kk')

    // 5. Empty File handling
    const fp2 = join(tmp, 'empty.yaml')
    const db3 = YamlCollection(fp2)
    check(db3.get(), {})
  })
})
